import { describe, expect, it } from 'vitest';
import { SYSTEM_CLOCK, SYSTEM_TIMERS } from '../../src/system/time.ts';

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
});
