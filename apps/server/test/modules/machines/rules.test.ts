import { describe, expect, it } from 'vitest';
import {
  endOfLostSession,
  isTooOld,
  MACHINE_LEASE_MS,
  MIN_RUNNER_VERSION,
  PRUNE_INTERVAL_MS,
  SAMPLE_RETENTION_MS,
  sampleMinute,
  TOKEN_EXPIRED,
  TOKEN_USED,
  tokenRefusal,
} from '../../../src/modules/machines/rules.ts';

const at = (iso: string) => new Date(iso);

describe('the numbers', () => {
  it('takes every runner for now, leases a machine 90 s, keeps samples 7 days and prunes hourly', () => {
    expect(MIN_RUNNER_VERSION).toBe('0.0.0');
    expect(MACHINE_LEASE_MS).toBe(90_000);
    expect(SAMPLE_RETENTION_MS).toBe(7 * 24 * 3_600_000);
    expect(PRUNE_INTERVAL_MS).toBe(3_600_000);
  });
});

describe('isTooOld', () => {
  it('is true only below the minimum, a prerelease of it included', () => {
    expect(isTooOld('0.3.9', '0.4.0')).toBe(true);
    expect(isTooOld('0.4.0-rc.1', '0.4.0')).toBe(true);
    expect(isTooOld('0.4.0', '0.4.0')).toBe(false);
    expect(isTooOld('1.0.0', MIN_RUNNER_VERSION)).toBe(false);
  });
});

describe('sampleMinute', () => {
  const now = at('2026-11-06T12:30:40.000Z');

  it("truncates a sample's time to its minute", () => {
    expect(sampleMinute(Date.parse('2026-11-06T12:29:59.999Z'), now)).toEqual(at('2026-11-06T12:29:00.000Z'));
    expect(sampleMinute(Date.parse('2026-11-06T12:00:00.000Z'), now)).toEqual(at('2026-11-06T12:00:00.000Z'));
  });

  it("keeps a sample from a clock running ahead under the server's minute", () => {
    expect(sampleMinute(Date.parse('2026-11-06T14:00:00.000Z'), now)).toEqual(at('2026-11-06T12:30:00.000Z'));
  });
});

describe('endOfLostSession', () => {
  it('is the last sign of life, never before the session began', () => {
    const began = at('2026-11-06T10:00:00Z');
    expect(endOfLostSession(began, at('2026-11-06T11:00:00Z'))).toEqual(at('2026-11-06T11:00:00Z'));
    expect(endOfLostSession(began, at('2026-11-06T09:00:00Z'))).toEqual(began);
    expect(endOfLostSession(began, null)).toEqual(began);
  });
});

describe('tokenRefusal', () => {
  const now = at('2026-11-06T12:00:00Z');

  it('refuses a used token, then an expired one (at its expiry too), and takes the rest', () => {
    expect(tokenRefusal({ usedAt: now, expiresAt: at('2026-11-06T13:00:00Z') }, now)).toBe(TOKEN_USED);
    expect(tokenRefusal({ usedAt: now, expiresAt: at('2026-11-06T11:00:00Z') }, now)).toBe(TOKEN_USED);
    expect(tokenRefusal({ usedAt: null, expiresAt: now }, now)).toBe(TOKEN_EXPIRED);
    expect(tokenRefusal({ usedAt: null, expiresAt: at('2026-11-06T12:00:01Z') }, now)).toBeUndefined();
    expect(TOKEN_USED).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' });
  });
});
