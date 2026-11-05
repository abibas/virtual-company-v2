import type { CredentialKind } from '@mwc/shared/enums';
import type { LimitWindow, LimitWindowId, UsageError, UsageSource } from '../schemas/limits.ts';

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
 * The least time between two checks of one subscription: 5 minutes for a usage API (they rate-limit), 15 for the
 * one-token Messages probe, which spends a little of the subscription.
 */
export const USAGE_FLOOR_MS: Readonly<Record<Exclude<UsageSource, 'none'>, number>> = {
  usage_api: 5 * MINUTE,
  message_headers: 15 * MINUTE,
};

/** `refresh=1` (or `true`) asks for a check of every subscription past its floor. */
export const wantsRefresh = (refresh: string | undefined) => refresh === '1' || refresh === 'true';

/** Whether a subscription checked at `checkedAt` may be checked again at `now`. */
export const pastFloor = (source: Exclude<UsageSource, 'none'>, checkedAt: Date, now: Date) =>
  now.getTime() - checkedAt.getTime() >= USAGE_FLOOR_MS[source];

export const WINDOW_LABELS: Readonly<Record<LimitWindowId, string>> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Opus weekly limit',
  seven_day_sonnet: 'Sonnet weekly limit',
  weekly: 'Weekly limit',
};

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
  return { id, label: WINDOW_LABELS[id], usedPercent: used, resetsAt, reached: reached ?? used >= 100 };
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
