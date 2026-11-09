import { describe, expect, it } from 'vitest';
import { inContainer, type MachineSamplerDeps, machineSampler } from '../../src/stats/machine.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

const DOCKERENV = '/.dockerenv';

/** A Linux machine whose /proc/meminfo says 50 % and whose cgroup limits it to 1 CPU and 1000 bytes, 100 in use. */
function machine(env: Record<string, string>, files: readonly string[] = []): MachineSamplerDeps {
  const texts: Record<string, string> = {
    '/proc/meminfo': 'MemTotal: 100 kB\nMemAvailable: 50 kB\n',
    '/sys/fs/cgroup/cpu.max': '100000 100000',
    '/sys/fs/cgroup/cpu.stat': 'usage_usec 0\n',
    '/sys/fs/cgroup/memory.max': '1000',
    '/sys/fs/cgroup/memory.current': '100',
  };
  const time = new FakeTime();
  return {
    env,
    platform: 'linux',
    os: {
      loadavg: () => [0, 0, 0],
      cpus: () => Array.from({ length: 8 }, () => ({ times: { user: 1, nice: 0, sys: 0, idle: 1, irq: 0 } })),
      uptime: () => 1,
      freemem: () => 1,
      totalmem: () => 2,
    },
    fs: {
      exists: (path) => files.includes(path),
      readFile: async (path) => texts[path] ?? Promise.reject(new Error('ENOENT')),
      statfs: async () => ({ bsize: 1, blocks: 1, bfree: 1 }),
    },
    spawn: new FakeSpawn().spawn,
    clock: time,
    timers: time,
  };
}

describe('the machine sampler', () => {
  it('knows a Linux runner is in a container by MWC_RUNNER_IN_CONTAINER=1 or Docker’s marker file', () => {
    const marker = { exists: (path: string) => path === DOCKERENV };
    expect(
      inContainer({ platform: 'linux', env: { MWC_RUNNER_IN_CONTAINER: '1' }, fs: { exists: () => false } }),
    ).toBe(true);
    expect(inContainer({ platform: 'linux', env: {}, fs: marker })).toBe(true);
    expect(inContainer({ platform: 'linux', env: {}, fs: { exists: () => false } })).toBe(false);
    expect(inContainer({ platform: 'darwin', env: { MWC_RUNNER_IN_CONTAINER: '1' }, fs: marker })).toBe(
      false,
    );
  });

  it('measures a container against its cgroup, and anything else as the machine it is', async () => {
    const container = machineSampler(machine({}, [DOCKERENV]), '/home/runner', memoryLog().log);
    await settle();
    expect(await container.sample(0)).toMatchObject({ cpus: 1, memPct: 10 });
    const vm = machineSampler(machine({}), '/home/runner', memoryLog().log);
    expect(await vm.sample(0)).toMatchObject({ cpus: 8, memPct: 50 });
  });
});
