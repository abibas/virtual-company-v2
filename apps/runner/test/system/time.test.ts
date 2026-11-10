import { describe, expect, it } from 'vitest';
import { every, SYSTEM_CLOCK, SYSTEM_TIMERS } from '../../src/system/time.ts';
import { FakeTime } from '../fixtures/time.ts';

describe("the system's clocks and timers", () => {
  it('reads the wall clock and a monotonic clock', () => {
    expect(Math.abs(SYSTEM_CLOCK.now() - Date.now())).toBeLessThan(1000);
    const first = SYSTEM_CLOCK.monotonic();
    expect(SYSTEM_CLOCK.monotonic()).toBeGreaterThanOrEqual(first);
  });

  it("fires Node's timers and clears them", async () => {
    const fired: string[] = [];
    const cleared = SYSTEM_TIMERS.setTimeout(() => fired.push('cleared'), 1);
    SYSTEM_TIMERS.clearTimeout(cleared);
    await new Promise<void>((resolve) => SYSTEM_TIMERS.setTimeout(resolve, 5));
    expect(fired).toEqual([]);
  });

  it('runs something every interval until it is stopped', async () => {
    const time = new FakeTime();
    let runs = 0;
    const stop = every(time, 1000, () => {
      runs += 1;
    });
    await time.advance(999);
    expect(runs).toBe(0);
    await time.advance(2001);
    expect(runs).toBe(3);
    stop();
    await time.advance(5000);
    expect([runs, time.pending]).toEqual([3, []]);
  });
});
