import { isIdentityProviderError } from '@mwc/identity-core';

/**
 * The retry policy of the identity jobs: the outbox of provider calls (`outbox.ts`) and the inbox of provider events
 * (the identity module's webhook inbox). A failed try waits 30 s, doubling up to an hour (or longer when the provider
 * asked for it with Retry-After); the 12th failed try gives the row up, about a day after the first.
 */

/** Tries of one row before it is given up (about a day with the delays below). */
export const RETRY_MAX_ATTEMPTS = 12;
/** The first retry delay; it doubles with every failed try. */
export const RETRY_FIRST_DELAY_MS = 30_000;
/** The longest retry delay, unless the provider asked for longer (Retry-After). */
export const RETRY_MAX_DELAY_MS = 3_600_000;
/** `last_error` is cut to this many characters. */
export const ERROR_LENGTH = 500;

/** The wait before the next try after `attempts` failed ones: 30 s doubling up to 1 h, or a longer Retry-After. */
export function retryDelayMs(attempts: number, retryAfterMs?: number): number {
  const backoff = Math.min(RETRY_FIRST_DELAY_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_DELAY_MS);
  return Math.max(backoff, retryAfterMs ?? 0);
}

/** What `last_error` says about a failure: a provider error's code and message, never a stack. */
export function describeFailure(error: unknown): string {
  const text = isIdentityProviderError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  return text.slice(0, ERROR_LENGTH);
}
