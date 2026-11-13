import { CredentialKind } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  amount,
  backoffMs,
  checkDue,
  codeOfStatus,
  isoTime,
  type LastCheck,
  limitWindow,
  members,
  pastFloor,
  resetPassed,
  retryAfterMs,
  text,
  usageError,
  usageSourceOf,
  wantsRefresh,
  windowLabel,
  windowOrder,
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
      github_oauth: 'none',
      github_token: 'none',
      atlassian_api_token: 'none',
      slack_bot_token: 'none',
      slack_user_token: 'none',
    });
  });
});

const AT = new Date('2026-11-03T12:00:00Z');
const later = (minutes: number) => new Date(AT.getTime() + minutes * 60_000);

describe('pastFloor', () => {
  it('waits 3 minutes for a usage API and 15 for the probe', () => {
    expect(pastFloor('usage_api', AT, later(2.99))).toBe(false);
    expect(pastFloor('usage_api', AT, later(3))).toBe(true);
    expect(pastFloor('message_headers', AT, later(14.99))).toBe(false);
    expect(pastFloor('message_headers', AT, later(15))).toBe(true);
  });
});

describe('checkDue', () => {
  const last = (fields: Partial<LastCheck> = {}): LastCheck => ({ checkedAt: AT, lastGood: null, ...fields });
  const resetIn = (minutes: number) => ({
    windows: [{ resetsAt: later(minutes).toISOString() }, { resetsAt: null }],
  });

  it('checks one never checked, and one past its floor', () => {
    expect(checkDue('usage_api', undefined, AT, false)).toBe(true);
    expect(checkDue('usage_api', last(), later(2.99), false)).toBe(false);
    expect(checkDue('usage_api', last(), later(3), false)).toBe(true);
    expect(checkDue('message_headers', last(), later(14), false)).toBe(false);
    expect(checkDue('message_headers', last(), later(15), false)).toBe(true);
  });

  it('checks one whose window reset since its last check at once, whatever the floor, but at most once a minute', () => {
    const reset = last({ lastGood: resetIn(0.5) });
    expect(checkDue('message_headers', reset, later(0.4), false)).toBe(false);
    expect(checkDue('message_headers', reset, later(0.99), false)).toBe(false);
    expect(checkDue('message_headers', reset, later(1), false)).toBe(true);
    expect(resetPassed(reset, later(0.5))).toBe(true);
    const before = last({ lastGood: resetIn(-1) });
    expect(resetPassed(before, later(1))).toBe(false);
    expect(checkDue('usage_api', before, later(1), false)).toBe(false);
  });

  it('forces a check at most once a minute, and never within a rate-limit wait', () => {
    expect(checkDue('message_headers', last(), later(0.99), true)).toBe(false);
    expect(checkDue('message_headers', last(), later(1), true)).toBe(true);
    const waiting = last({ retryAt: later(6), lastGood: resetIn(2) });
    expect(checkDue('usage_api', waiting, later(5.99), true)).toBe(false);
    expect(checkDue('usage_api', waiting, later(6), false)).toBe(true);
    expect(checkDue('usage_api', last({ retryAt: null }), later(3), false)).toBe(true);
  });
});

describe('the rate-limit wait', () => {
  it('backs off 3, 6, 12, then 15 minutes', () => {
    expect([1, 2, 3, 4, 5, 0].map((n) => backoffMs(n) / 60_000)).toEqual([3, 6, 12, 15, 15, 3]);
  });

  it('reads Retry-After as seconds or an HTTP date, at most an hour, else null', () => {
    expect(retryAfterMs('120', AT)).toBe(120_000);
    expect(retryAfterMs(' 0 ', AT)).toBe(0);
    expect(retryAfterMs(later(10).toUTCString(), AT)).toBe(600_000);
    expect(retryAfterMs(later(-10).toUTCString(), AT)).toBe(0);
    expect(retryAfterMs('86400', AT)).toBe(60 * 60_000);
    for (const value of [null, undefined, '', '  ', 'soon']) expect(retryAfterMs(value, AT)).toBeNull();
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
      label: 'Weekly · Opus',
      reached: true,
    });
    expect(limitWindow('seven_day_sonnet', 100, null, false)).toMatchObject({ reached: false });
  });

  it('labels each window by its length and model', () => {
    expect(
      [
        'five_hour',
        'seven_day',
        'weekly',
        'seven_day_fable',
        'seven_day_opus',
        'five_hour_fable',
        'other',
      ].map(windowLabel),
    ).toEqual([
      '5-hour limit',
      'Weekly limit',
      'Weekly limit',
      'Weekly · Fable',
      'Weekly · Opus',
      '5-hour · Fable',
      'other',
    ]);
  });

  it('orders the 5-hour window first, the weekly one next, then the per-model ones as given', () => {
    const ids = ['seven_day_fable', 'seven_day', 'five_hour_opus', 'five_hour', 'seven_day_opus'];
    expect(windowOrder(ids.map((id) => limitWindow(id, 1, null))).map((w) => w.id)).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_fable',
      'five_hour_opus',
      'seven_day_opus',
    ]);
    expect(
      windowOrder([limitWindow('weekly', 1, null), limitWindow('five_hour', 1, null)]).map((w) => w.id),
    ).toEqual(['five_hour', 'weekly']);
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
