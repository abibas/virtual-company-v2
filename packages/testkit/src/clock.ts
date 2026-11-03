/** The instant tests use when the exact time does not matter but must be stable. */
export const TEST_NOW = '2026-11-03T12:00:00.000Z';

/** A clock that stands still until a test moves it; call it like `() => Date`. */
export interface TestClock {
  (): Date;
  /** Moves the clock by `ms` (negative goes back). */
  advance(ms: number): void;
  /** Puts the clock at `at`. */
  set(at: Date | string | number): void;
}

/**
 * A fixed clock for `createTestApp({ clock })` (the app's `c.var.clock()`) and anything else that
 * takes `() => Date`. Every call returns a new Date, so a caller mutating one changes nothing.
 */
export function fixedClock(at: Date | string | number = TEST_NOW): TestClock {
  let now = new Date(at).getTime();
  if (Number.isNaN(now)) throw new Error(`fixedClock: not a time: ${String(at)}`);
  const clock = (() => new Date(now)) as TestClock;
  clock.advance = (ms) => {
    now += ms;
  };
  clock.set = (next) => {
    now = new Date(next).getTime();
  };
  return clock;
}
