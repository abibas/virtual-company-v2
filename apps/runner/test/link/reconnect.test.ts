import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  closeDecision,
  RECONNECT_INITIAL_MS,
  RECONNECT_JITTER,
  RECONNECT_MAX_MS,
} from '../../src/link/reconnect.ts';

describe('the reconnect backoff', () => {
  it('doubles from 1 s to 60 s without jitter', () => {
    const none = () => 0;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((attempt) => backoffDelay(attempt, none))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
    expect(backoffDelay(Number.POSITIVE_INFINITY, none)).toBe(RECONNECT_MAX_MS);
    expect(backoffDelay(-3, none)).toBe(RECONNECT_INITIAL_MS);
  });

  it('adds up to a fifth more at random, and never more', () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const base = backoffDelay(attempt, () => 0);
      for (const random of [0, 0.25, 0.5, 0.999999]) {
        const delay = backoffDelay(attempt, () => random);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThanOrEqual(base * (1 + RECONNECT_JITTER));
      }
    }
    expect(backoffDelay(0, () => 0.5)).toBe(1_100);
    expect(backoffDelay(10, () => 0.5)).toBe(66_000);
    // A random source out of [0, 1) is held to it.
    expect(backoffDelay(0, () => 7)).toBe(1_200);
    expect(backoffDelay(0, () => -1)).toBe(1_000);
  });
});

describe('what a close means', () => {
  it('stops for a refused key (HTTP 401 or 4001) and a runner too old (4003)', () => {
    expect(closeDecision(1006, 401)).toEqual({ kind: 'end', reason: 'unauthorized' });
    expect(closeDecision(4001)).toEqual({ kind: 'end', reason: 'unauthorized' });
    expect(closeDecision(4003)).toEqual({ kind: 'end', reason: 'too_old' });
  });

  it('ends the link without reconnecting when replaced (4004)', () => {
    expect(closeDecision(4004)).toEqual({ kind: 'end', reason: 'replaced' });
  });

  it('reconnects after everything else, at the slowest pace for a protocol the server does not speak', () => {
    for (const code of [1000, 1001, 1006, 1009, 1011, 4008]) {
      expect(closeDecision(code)).toEqual({ kind: 'reconnect', slowest: false });
    }
    expect(closeDecision(1006, 502)).toEqual({ kind: 'reconnect', slowest: false });
    expect(closeDecision(4002)).toEqual({ kind: 'reconnect', slowest: true });
  });
});
