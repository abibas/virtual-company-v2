import { describe, expect, it } from 'vitest';
import { Throttle } from '../../../src/platform/http/throttle.ts';

describe('Throttle', () => {
  it('grants one turn per key per interval and says how long is left until the next', () => {
    const throttle = new Throttle(10_000, 10);
    expect(throttle.take('ihor', 1_000)).toBe(0);
    expect(throttle.take('ihor', 1_000)).toBe(10_000);
    expect(throttle.take('ihor', 7_500)).toBe(3_500);
    expect(throttle.take('ihor', 10_999)).toBe(1);
    expect(throttle.take('ihor', 11_000)).toBe(0);
    // A refused try does not move the window: the next turn is still 10 s after the last granted one.
    expect(throttle.take('ihor', 20_999)).toBe(1);
    expect(throttle.take('ihor', 21_000)).toBe(0);
  });

  it('keeps keys apart', () => {
    const throttle = new Throttle(10_000, 10);
    expect(throttle.take('ihor', 0)).toBe(0);
    expect(throttle.take('second', 0)).toBe(0);
    expect(throttle.take('ihor', 1)).toBe(9_999);
    expect(throttle.take('second', 1)).toBe(9_999);
  });

  it('counts a clock that went back as a new turn', () => {
    const throttle = new Throttle(10_000, 10);
    expect(throttle.take('ihor', 50_000)).toBe(0);
    expect(throttle.take('ihor', 40_000)).toBe(0);
    expect(throttle.take('ihor', 40_001)).toBe(9_999);
  });

  it('remembers at most max keys, forgetting the least recently granted first', () => {
    const throttle = new Throttle(10_000, 2);
    expect(throttle.take('a', 0)).toBe(0);
    expect(throttle.take('b', 0)).toBe(0);
    expect(throttle.take('c', 0)).toBe(0);
    // `a` was forgotten, so it gets a turn again; `c` is still remembered.
    expect(throttle.take('a', 1)).toBe(0);
    expect(throttle.take('c', 1)).toBe(9_999);
    // Granting `a` again made it the newest, so `b` (then the oldest) was the one forgotten.
    expect(throttle.take('b', 2)).toBe(0);
  });
});
