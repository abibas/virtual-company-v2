import { CredentialKind } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  amount,
  codeOfStatus,
  isoTime,
  limitWindow,
  members,
  pastFloor,
  text,
  usageError,
  usageSourceOf,
  wantsRefresh,
} from '../../../../src/modules/credentials/rules/limits.ts';

describe('usageSourceOf', () => {
  it('gives the logins the usage API, a setup-token the Messages headers, and the rest nothing', () => {
    expect(Object.fromEntries(CredentialKind.options.map((kind) => [kind, usageSourceOf(kind)]))).toEqual({
      claude_oauth: 'usage_api',
      claude_setup_token: 'message_headers',
      codex_oauth: 'usage_api',
      anthropic_api_key: 'none',
      openai_api_key: 'none',
      gateway: 'none',
    });
  });
});

describe('pastFloor', () => {
  it('waits 5 minutes for a usage API and 15 for the probe', () => {
    const at = new Date('2026-11-03T12:00:00Z');
    const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
    expect(pastFloor('usage_api', at, later(4.99))).toBe(false);
    expect(pastFloor('usage_api', at, later(5))).toBe(true);
    expect(pastFloor('message_headers', at, later(14.99))).toBe(false);
    expect(pastFloor('message_headers', at, later(15))).toBe(true);
  });
});

describe('limitWindow', () => {
  it('keeps the percentage within 0–100, rounds it to two decimals, and is reached at 100 or when told', () => {
    expect(limitWindow('five_hour', 12.3456, null)).toEqual({
      id: 'five_hour',
      label: '5-hour limit',
      usedPercent: 12.35,
      resetsAt: null,
      reached: false,
    });
    expect(limitWindow('weekly', 130, null)).toMatchObject({ usedPercent: 100, reached: true });
    expect(limitWindow('seven_day', -3, null)).toMatchObject({ usedPercent: 0, reached: false });
    expect(limitWindow('seven_day_opus', 10, null, true)).toMatchObject({
      label: 'Opus weekly limit',
      reached: true,
    });
    expect(limitWindow('seven_day_sonnet', 100, null, false)).toMatchObject({ reached: false });
  });
});

describe('isoTime', () => {
  it('reads epoch seconds (as a number or digits) and date strings', () => {
    expect(isoTime(1_762_190_000)).toBe('2025-11-03T17:13:20.000Z');
    expect(isoTime('1762190000')).toBe('2025-11-03T17:13:20.000Z');
    expect(isoTime('1762190000.5')).toBe('2025-11-03T17:13:20.500Z');
    expect(isoTime('2026-11-03T15:00:00+02:00')).toBe('2026-11-03T13:00:00.000Z');
  });

  it('gives null for anything else', () => {
    for (const value of [
      undefined,
      null,
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      'soon',
      '',
      {},
      true,
    ]) {
      expect(isoTime(value)).toBeNull();
    }
  });
});

describe('reading an answer', () => {
  it('takes finite non-negative numbers, objects and non-empty strings only', () => {
    expect([1.5, 0, -1, Number.NaN, '3', null].map(amount)).toEqual([1.5, 0, null, null, null, null]);
    expect(members({ a: 1 })).toEqual({ a: 1 });
    expect([null, [1], 'x', 3].map(members)).toEqual([{}, {}, {}, {}]);
    expect(['a', '', 3, undefined].map(text)).toEqual(['a', undefined, undefined, undefined]);
  });
});

describe('the refusals', () => {
  it('maps a usage check refusal to its code and says it in plain words', () => {
    expect([401, 403, 429, 500, 418].map(codeOfStatus)).toEqual([
      'needs_sign_in',
      'usage_refused',
      'rate_limited',
      'provider_unavailable',
      'provider_unavailable',
    ]);
    expect(usageError('rate_limited')).toEqual({
      code: 'rate_limited',
      message: 'The provider rate limited the usage check. Try again later.',
    });
  });

  it('asks for a check with refresh=1 or true only', () => {
    expect(['1', 'true', '0', 'false', undefined].map(wantsRefresh)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
