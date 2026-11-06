import { describe, expect, it } from 'vitest';
import { cpuPercent, cpuTotals } from '../../src/stats/cpu.ts';

const core = (user: number, sys: number, idle: number, nice = 0, irq = 0) => ({
  times: { user, nice, sys, idle, irq },
});

describe('CPU use', () => {
  it('sums busy and total time over every core', () => {
    expect(cpuTotals([core(100, 50, 850, 5, 1), core(200, 0, 800)])).toEqual({ busy: 356, total: 2006 });
    expect(cpuTotals([])).toEqual({ busy: 0, total: 0 });
  });

  it('is the busy share between two readings, to a tenth', () => {
    const before = cpuTotals([core(100, 0, 900), core(100, 0, 900)]);
    const after = cpuTotals([core(400, 100, 1500), core(150, 50, 1800)]);
    // busy +500 of +2000
    expect(cpuPercent(before, after)).toBe(25);
    expect(cpuPercent({ busy: 0, total: 0 }, { busy: 1, total: 3 })).toBe(33.3);
  });

  it('falls back to the average since boot with no time between readings or counters that went back', () => {
    const now = { busy: 250, total: 1000 };
    expect(cpuPercent(now, now)).toBe(25);
    expect(cpuPercent({ busy: 300, total: 900 }, now)).toBe(25);
    expect(cpuPercent({ busy: 0, total: 0 }, { busy: 0, total: 0 })).toBe(0);
  });
});
