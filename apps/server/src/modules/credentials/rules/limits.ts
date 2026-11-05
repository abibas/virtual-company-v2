import type { CredentialKind } from '@mwc/shared/enums';
import {
  LIMIT_WINDOW_ID,
  type LimitWindow,
  type LimitWindowId,
  type UsageError,
  type UsageSource,
} from '../schemas/limits.ts';

/**
 * The limits' pure rules (S3.3, docs/subscriptions.md "The limits widget"): where each kind's limits come from, how
 * often each may be checked, what a window says, and the refusals in plain words.
 */

/** Where each kind's limits come from: the logins' usage APIs, a setup-token's Messages headers, else none. */
export function usageSourceOf(kind: CredentialKind): UsageSource {
  switch (kind) {
    case 'claude_oauth':
    case 'codex_oauth':
      return 'usage_api';
    case 'claude_setup_token':
      return 'message_headers';
    default:
      return 'none';
  }
}

const MINUTE = 60_000;

/**
 * The least time between two checks of one subscription: 3 minutes for a usage API (a Claude or OpenAI login), 15 for
 * the one-token Messages probe, which spends a little of the subscription.
 */
export const USAGE_FLOOR_MS: Readonly<Record<Exclude<UsageSource, 'none'>, number>> = {
  usage_api: 3 * MINUTE,
  message_headers: 15 * MINUTE,
};

/** The least time between two checks whatever asks for them: a forced refresh, or a window whose reset has passed. */
export const RECHECK_CAP_MS = MINUTE;

/** After a 429 without `Retry-After`: 3, 6, 12 minutes, then 15 each time until a check gets through. */
export const BACKOFF_MS = { first: 3 * MINUTE, max: 15 * MINUTE } as const;

/** The longest `Retry-After` honoured, so an odd answer cannot silence a subscription for days. */
export const MAX_RETRY_AFTER_MS = 60 * MINUTE;

/** `refresh=1` (or `true`) forces a check of every subscription, still at most once a minute each. */
export const wantsRefresh = (refresh: string | undefined) => refresh === '1' || refresh === 'true';

/** Whether a subscription checked at `checkedAt` may be checked again at `now`. */
export const pastFloor = (source: Exclude<UsageSource, 'none'>, checkedAt: Date, now: Date) =>
  now.getTime() - checkedAt.getTime() >= USAGE_FLOOR_MS[source];

/** What decides whether a subscription is due: its last check, its rate-limit wait and its last good windows. */
export interface LastCheck {
  readonly checkedAt: Date;
  readonly retryAt?: Date | null;
  readonly lastGood: { readonly windows: readonly Pick<LimitWindow, 'resetsAt'>[] } | null;
}

/** Whether one of the last good windows reset after the last check, so its numbers are surely old. */
export function resetPassed(last: LastCheck, now: Date): boolean {
  return (last.lastGood?.windows ?? []).some((window) => {
    if (window.resetsAt === null) return false;
    const at = Date.parse(window.resetsAt);
    return at > last.checkedAt.getTime() && at <= now.getTime();
  });
}

/**
 * Whether a subscription is checked on this request: one never checked, always; else never within a provider's
 * rate-limit wait nor within a minute of the last check, and then when forced, when a window reset since the last
 * check, or past its floor.
 */
export function checkDue(
  source: Exclude<UsageSource, 'none'>,
  last: LastCheck | undefined,
  now: Date,
  force: boolean,
): boolean {
  if (last === undefined) return true;
  if (last.retryAt && now.getTime() < last.retryAt.getTime()) return false;
  if (now.getTime() - last.checkedAt.getTime() < RECHECK_CAP_MS) return false;
  return force || resetPassed(last, now) || pastFloor(source, last.checkedAt, now);
}

/** The wait after the n-th 429 in a row (n ≥ 1) without `Retry-After`: doubling from 3 minutes, at most 15. */
export const backoffMs = (n: number) => Math.min(BACKOFF_MS.max, BACKOFF_MS.first * 2 ** Math.max(0, n - 1));

/** A `Retry-After` header as a wait in ms: seconds, or an HTTP date from `now`; at most an hour; else null. */
export function retryAfterMs(value: string | null | undefined, now: Date): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

const BASE_LABELS: Readonly<Record<string, readonly [whole: string, short: string]>> = {
  five_hour: ['5-hour limit', '5-hour'],
  seven_day: ['Weekly limit', 'Weekly'],
  weekly: ['Weekly limit', 'Weekly'],
};

/** A window's label: "5-hour limit", "Weekly limit", or per model "Weekly · Fable", "5-hour · Opus". */
export function windowLabel(id: LimitWindowId): string {
  const [, base = '', model] = LIMIT_WINDOW_ID.exec(id) ?? [];
  const [whole, short] = BASE_LABELS[base] ?? [id, id];
  return model ? `${short} · ${model.charAt(0).toUpperCase()}${model.slice(1)}` : whole;
}

/** The card's order: the 5-hour window, the weekly one, then the per-model ones in the provider's order. */
export function windowOrder(windows: readonly LimitWindow[]): LimitWindow[] {
  const rank = (id: string) => (id === 'five_hour' ? 0 : id === 'seven_day' || id === 'weekly' ? 1 : 2);
  return [...windows].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * A window as the API shows it: the percentage used kept within 0–100 and rounded to two decimals, and reached when
 * the provider says so or at 100%.
 */
export function limitWindow(
  id: LimitWindowId,
  usedPercent: number,
  resetsAt: string | null,
  reached?: boolean,
): LimitWindow {
  const used = Math.round(Math.min(100, Math.max(0, usedPercent)) * 100) / 100;
  return { id, label: windowLabel(id), usedPercent: used, resetsAt, reached: reached ?? used >= 100 };
}

/** A provider's time as ISO: epoch seconds (a number, or digits in a header), or a date string; else null. */
export function isoTime(value: unknown): string | null {
  const seconds = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  let date: Date;
  if (typeof seconds === 'number') {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    date = new Date(seconds * 1000);
  } else if (typeof seconds === 'string') date = new Date(seconds);
  else return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A finite, non-negative number; else null. */
export const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** A JSON object's members; anything else reads as an empty object. */
export const members = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A non-empty string; else undefined. */
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Why a check gave no fresh windows. */
export type UsageErrorCode =
  | 'needs_sign_in'
  | 'rate_limited'
  | 'usage_refused'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'credential_revoked'
  | 'credential_not_found'
  | 'check_failed';

const USAGE_MESSAGES: Readonly<Record<UsageErrorCode, string>> = {
  needs_sign_in: 'Sign in to this subscription again.',
  rate_limited: 'The provider rate limited the usage check. Try again later.',
  usage_refused: 'The provider refused the usage check. Try again later.',
  provider_unavailable: 'The provider did not answer the usage check. Try again later.',
  invalid_response: "The provider's answer to the usage check could not be read.",
  credential_revoked: 'This subscription was revoked; add it again.',
  credential_not_found: 'This subscription was removed.',
  check_failed: 'The usage check failed. Try again later.',
};

/** A refusal in plain words, for the card. */
export const usageError = (code: UsageErrorCode): UsageError => ({ code, message: USAGE_MESSAGES[code] });

/** What a provider's refusal of a usage check means (401 is handled before: it refreshes or asks to sign in). */
export function codeOfStatus(status: number): UsageErrorCode {
  if (status === 401) return 'needs_sign_in';
  if (status === 403) return 'usage_refused';
  if (status === 429) return 'rate_limited';
  return 'provider_unavailable';
}
