import { describe, expect, it } from 'vitest';
import {
  createMemoryReader,
  MEMINFO,
  type MemoryDeps,
  parseMeminfo,
  parseMemorystatusLevel,
  percent,
  SYSCTL,
} from '../../src/stats/memory.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

const MEMINFO_TEXT = [
  'MemTotal:       16000000 kB',
  'MemFree:         1000000 kB',
  'MemAvailable:    4000000 kB',
].join('\n');

function deps(platform: NodeJS.Platform, overrides: Partial<MemoryDeps> = {}) {
  const time = new FakeTime();
  const spawn = new FakeSpawn();
  const logs = memoryLog();
  const reads: string[] = [];
  const memoryDeps: MemoryDeps = {
    platform,
    os: { freemem: () => 2_000, totalmem: () => 8_000 },
    readFile: async (path) => {
      reads.push(path);
      return MEMINFO_TEXT;
    },
    spawn: spawn.spawn,
    clock: time,
    timers: time,
    log: logs.log,
    ...overrides,
  };
  return { memoryDeps, time, spawn, logs, reads };
}

describe('parsing', () => {
  it('reads MemAvailable over MemTotal from /proc/meminfo', () => {
    expect(parseMeminfo(MEMINFO_TEXT)).toBe(75);
    expect(parseMeminfo('MemTotal: 100 kB\nMemFree: 5 kB')).toBeUndefined();
    expect(parseMeminfo('MemTotal: 0 kB\nMemAvailable: 0 kB')).toBeUndefined();
  });

  it('reads kern.memorystatus_level as the share free', () => {
    expect(parseMemorystatusLevel('62\n')).toBe(38);
    expect(parseMemorystatusLevel('100')).toBe(0);
    expect(parseMemorystatusLevel('101')).toBeUndefined();
    expect(parseMemorystatusLevel('sysctl: unknown oid')).toBeUndefined();
  });

  it('keeps percentages within 0–100, to a tenth', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(5, 0)).toBe(0);
    expect(percent(-1, 10)).toBe(0);
    expect(percent(20, 10)).toBe(100);
  });
});

describe('the memory reader', () => {
  it('on Linux reads /proc/meminfo (no process), and free memory when it cannot', async () => {
    const { memoryDeps, spawn, reads } = deps('linux');
    expect(await createMemoryReader(memoryDeps)()).toBe(75);
    expect(reads).toEqual([MEMINFO]);
    expect(spawn.calls).toEqual([]);
    const broken = deps('linux', { readFile: async () => 'MemTotal: 10 kB' }).memoryDeps;
    expect(await createMemoryReader(broken)()).toBe(75);
    const missing = deps('linux', {
      readFile: async () => {
        throw new Error('ENOENT');
      },
    }).memoryDeps;
    expect(await createMemoryReader(missing)()).toBe(75);
  });

  it('elsewhere uses free memory over total memory', async () => {
    const { memoryDeps, spawn } = deps('win32');
    expect(await createMemoryReader(memoryDeps)()).toBe(75);
    expect(spawn.calls).toEqual([]);
  });

  it('on macOS starts one sysctl a minute at most and keeps the value between', async () => {
    const { memoryDeps, spawn, time } = deps('darwin');
    let level = '62';
    spawn.when(SYSCTL, (child) => child.finish(`${level}\n`));
    const read = createMemoryReader(memoryDeps);
    expect(await read()).toBe(38);
    expect(spawn.calls.map((call) => [call.file, ...call.args])).toEqual([
      [SYSCTL, '-n', 'kern.memorystatus_level'],
    ]);
    level = '10';
    time.wall += 59_999;
    expect(await read()).toBe(38);
    expect(spawn.calls).toHaveLength(1);
    time.wall += 1;
    expect(await read()).toBe(90);
    expect(spawn.calls).toHaveLength(2);
    time.wall -= 5_000;
    expect(await read()).toBe(90);
    expect(spawn.calls).toHaveLength(3);
  });

  it('on macOS falls back to free memory when sysctl fails, and says so once', async () => {
    const { memoryDeps, spawn, time, logs } = deps('darwin');
    spawn.when(SYSCTL, (child) => child.finish('', 1));
    const read = createMemoryReader(memoryDeps);
    expect(await read()).toBe(75);
    time.wall += 60_000;
    spawn.when(SYSCTL, (child) => child.finish('garbage'));
    expect(await read()).toBe(75);
    expect(logs.messages('warn')).toEqual(['cannot read kern.memorystatus_level; using free memory']);
  });
});
