import { describe, expect, it } from 'vitest';
import { CGROUP_DIR, CgroupStats, parseBytes, parseCpuMax, statField } from '../../src/stats/cgroup.ts';
import { FakeTime } from '../fixtures/time.ts';

/** A cgroup folder of fake files; a missing one rejects as a real read would. */
function cgroup(files: Record<string, string>, dir?: string) {
  const time = new FakeTime();
  const reads: string[] = [];
  const stats = new CgroupStats({
    readFile: async (path) => {
      reads.push(path);
      const name = path.slice(path.lastIndexOf('/') + 1);
      const text = files[name];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    clock: time,
    ...(dir ? { dir } : {}),
  });
  return { stats, time, files, reads };
}

const usage = (usec: number) => `usage_usec ${usec}\nuser_usec 1\nsystem_usec 1\n`;

describe('the cgroup files', () => {
  it('reads cpu.max as CPUs, unlimited or malformed as none', () => {
    expect(parseCpuMax('200000 100000\n')).toBe(2);
    expect(parseCpuMax('150000 100000')).toBe(1.5);
    expect(parseCpuMax('max 100000\n')).toBeUndefined();
    expect(parseCpuMax('0 100000')).toBeUndefined();
    expect(parseCpuMax('100000 0')).toBeUndefined();
    expect(parseCpuMax('')).toBeUndefined();
  });

  it('reads a field of a key-value file and a byte count', () => {
    expect(statField(usage(123), 'usage_usec')).toBe(123);
    expect(statField('anon 5\ninactive_file 4096\n', 'inactive_file')).toBe(4096);
    expect(statField('anon 5\n', 'inactive_file')).toBeUndefined();
    expect(parseBytes('4294967296\n')).toBe(4294967296);
    expect(parseBytes('max\n')).toBeUndefined();
    expect(parseBytes('0')).toBeUndefined();
  });
});

describe("a container's limits and use", () => {
  it('gives the CPU limit to a tenth and its use between readings against that limit', async () => {
    const c = cgroup({ 'cpu.max': '250000 100000\n', 'cpu.stat': usage(1_000_000) });
    await c.stats.prime();
    expect(c.reads[0]).toBe(`${CGROUP_DIR}/cpu.stat`);
    // 60 s at 2.5 CPUs is 150 CPU-seconds; 30 of them used is 20 %.
    c.time.wall += 60_000;
    c.files['cpu.stat'] = usage(31_000_000);
    expect(await c.stats.cpu()).toEqual({ cpus: 2.5, cpuPct: 20 });
    // Never above 100 %, and to a tenth.
    c.time.wall += 1_000;
    c.files['cpu.stat'] = usage(41_000_000);
    expect(await c.stats.cpu()).toEqual({ cpus: 2.5, cpuPct: 100 });
    c.files['cpu.max'] = '33333 100000';
    expect((await c.stats.cpu())?.cpus).toBe(0.3);
    c.files['cpu.max'] = '5000 100000';
    expect((await c.stats.cpu())?.cpus).toBe(0.1);
  });

  it('gives the limit without a use on the first reading, when time did not move or the counter went back', async () => {
    const c = cgroup({ 'cpu.max': '100000 100000', 'cpu.stat': usage(5_000_000) }, '/cg');
    expect(await c.stats.cpu()).toEqual({ cpus: 1 });
    expect(c.reads[0]).toBe('/cg/cpu.max');
    expect(await c.stats.cpu()).toEqual({ cpus: 1 });
    c.time.wall += 10_000;
    c.files['cpu.stat'] = usage(1_000_000);
    expect(await c.stats.cpu()).toEqual({ cpus: 1 });
    c.time.wall += 10_000;
    c.files['cpu.stat'] = usage(6_000_000);
    expect(await c.stats.cpu()).toEqual({ cpus: 1, cpuPct: 50 });
  });

  it('gives memory in use against memory.max, less the file cache it can drop', async () => {
    const c = cgroup({
      'memory.max': '1000\n',
      'memory.current': '600\n',
      'memory.stat': 'inactive_file 100\n',
    });
    expect(await c.stats.memory()).toBe(50);
    c.files['memory.stat'] = 'anon 600\n';
    expect(await c.stats.memory()).toBe(60);
    delete c.files['memory.stat'];
    expect(await c.stats.memory()).toBe(60);
    c.files['memory.stat'] = 'inactive_file 900\n';
    expect(await c.stats.memory()).toBe(0);
  });

  it('gives nothing when unlimited, so the sampler keeps the machine’s numbers', async () => {
    const c = cgroup({
      'cpu.max': 'max 100000\n',
      'cpu.stat': usage(1),
      'memory.max': 'max\n',
      'memory.current': '9',
    });
    await c.stats.prime();
    expect(await c.stats.cpu()).toBeUndefined();
    expect(await c.stats.memory()).toBeUndefined();
  });

  it('gives nothing, and never rejects, when the files are missing (cgroup v1, or not a container)', async () => {
    const none = cgroup({});
    await expect(none.stats.prime()).resolves.toBeUndefined();
    expect(await none.stats.cpu()).toBeUndefined();
    expect(await none.stats.memory()).toBeUndefined();
    const noStat = cgroup({ 'cpu.max': '200000 100000', 'memory.max': '1000' });
    expect(await noStat.stats.cpu()).toEqual({ cpus: 2 });
    expect(await noStat.stats.memory()).toBeUndefined();
  });
});
