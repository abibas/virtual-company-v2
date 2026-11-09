import { MachineSample } from '@mwc/shared/machines';
import { describe, expect, it } from 'vitest';
import { CgroupStats } from '../../src/stats/cgroup.ts';
import { type DiskStats, Sampler, type SamplerOs } from '../../src/stats/sampler.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

const core = (busy: number, idle: number) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

function fakeOs(): SamplerOs & { cores: ReturnType<typeof core>[]; loads: number[] } {
  const os = {
    cores: [core(100, 900), core(100, 900)],
    loads: [1.234, 0.5, 0.25],
    loadavg: () => os.loads,
    cpus: () => os.cores,
    uptime: () => 3600.9,
  };
  return os;
}

const DISK: DiskStats = { bsize: 4096, blocks: 1000, bfree: 250 };

function sampler(
  overrides: {
    statfs?: (path: string) => Promise<DiskStats>;
    memory?: number;
    cgroup?: (time: FakeTime) => CgroupStats;
  } = {},
) {
  const time = new FakeTime();
  const os = fakeOs();
  const logs = memoryLog();
  const homes: string[] = [];
  const instance = new Sampler({
    os,
    statfs:
      overrides.statfs ??
      (async (path) => {
        homes.push(path);
        return DISK;
      }),
    home: '/Users/ihor',
    memory: async () => overrides.memory ?? 41.27,
    ...(overrides.cgroup ? { cgroup: overrides.cgroup(time) } : {}),
    clock: time,
    log: logs.log,
  });
  return { instance, os, time, logs, homes };
}

describe('the sampler', () => {
  it('takes loads, CPU since the last sample, cores, memory, the home disk, uptime and live runs', async () => {
    const { instance, os, time, homes } = sampler();
    os.cores = [core(400, 1600), core(100, 1900)];
    const sample = await instance.sample(2);
    expect(sample).toEqual({
      load1: 1.23,
      load5: 0.5,
      load15: 0.25,
      cpus: 2,
      cpuPct: 15,
      memPct: 41.3,
      diskUsed: 750 * 4096,
      diskTotal: 1000 * 4096,
      uptimeS: 3600,
      liveRuns: 2,
      at: time.now(),
    });
    expect(MachineSample.parse(sample)).toEqual(sample);
    expect(homes).toEqual(['/Users/ihor']);
    os.cores = [core(500, 1650), core(100, 1950)];
    expect((await instance.sample(0)).cpuPct).toBe(50);
    expect(instance.load1()).toBe(1.23);
  });

  it('keeps every value valid for a strange machine: no cores, odd loads, memory over 100', async () => {
    const { instance, os } = sampler({ memory: 140 });
    os.cores = [];
    os.loads = [Number.NaN, -1];
    const sample = await instance.sample(-3);
    expect(sample).toMatchObject({ cpus: 1, load1: 0, load5: 0, load15: 0, memPct: 100, liveRuns: 0 });
    expect(MachineSample.safeParse(sample).success).toBe(true);
    expect(instance.load1()).toBe(0);
  });

  it('reports no disk when the home folder cannot be measured, and says so once', async () => {
    const { instance, logs } = sampler({
      statfs: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(await instance.sample(0)).toMatchObject({ diskUsed: 0, diskTotal: 0 });
    await instance.sample(0);
    expect(logs.entries.filter((entry) => entry.level === 'warn')).toEqual([
      expect.objectContaining({
        msg: 'cannot read the disk of the home folder',
        home: '/Users/ihor',
        error: 'ENOENT',
      }),
    ]);
  });

  it('measures a container against its own limits: CPUs, CPU use and memory from its cgroup', async () => {
    const files: Record<string, string> = {
      'cpu.max': '150000 100000',
      'cpu.stat': 'usage_usec 0\n',
      'memory.max': '2000',
      'memory.current': '500',
    };
    const readFile = async (path: string) => {
      const text = files[path.slice(path.lastIndexOf('/') + 1)];
      if (text === undefined) throw new Error('ENOENT');
      return text;
    };
    const { instance, time } = sampler({ cgroup: (clock) => new CgroupStats({ readFile, clock }) });
    await settle();
    time.wall += 60_000;
    files['cpu.stat'] = 'usage_usec 45000000\n';
    // 45 CPU-seconds of 90 (1.5 CPUs for a minute); the sample's CPUs are a whole number.
    expect(await instance.sample(0)).toMatchObject({ cpus: 2, cpuPct: 50, memPct: 25 });
    // Unlimited: the machine's own numbers (2 cores, 41.27 % memory).
    files['cpu.max'] = 'max 100000';
    files['memory.max'] = 'max';
    expect(await instance.sample(0)).toMatchObject({ cpus: 2, memPct: 41.3 });
    files['cpu.max'] = '50000 100000';
    expect((await instance.sample(0)).cpus).toBe(1);
  });
});
