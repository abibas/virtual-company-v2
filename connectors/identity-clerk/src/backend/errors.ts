import { TokenVerificationError } from '@clerk/backend/errors';
import { IdentityProviderError, type IdentityProviderErrorCode } from '@mwc/identity-core';

/** How long to wait after a 429 that carries no Retry-After: Clerk's Backend API window is 10 seconds. */
export const DEFAULT_RETRY_AFTER_MS = 10_000;

/** Clerk error codes (HTTP 400/422) that mean "contradicts the current state", not "bad input". */
const CONFLICT_CODE = /exists|duplicate|already|taken|not_pending|minimum_permissions/;

/**
 * Token verification failures that are an outage or our configuration (the JWKS did not load, no key to
 * verify with, a refused secret key), not a bad token: the caller answers 503, not 401.
 */
const UNAVAILABLE_TOKEN_REASONS: ReadonlySet<string> = new Set([
  'jwk-remote-failed-to-load',
  'jwk-failed-to-resolve',
  'secret-key-invalid',
]);

/** The fields of `ClerkAPIResponseError` (@clerk/backend/errors) this mapping reads. */
interface ClerkApiErrorLike {
  readonly clerkError: true;
  readonly status?: number;
  readonly retryAfter?: number;
  readonly errors?: ReadonlyArray<{
    readonly code?: string;
    readonly message?: string;
    readonly longMessage?: string;
  }>;
}

function isClerkApiError(error: unknown): error is ClerkApiErrorLike {
  return (
    typeof error === 'object' && error !== null && (error as { clerkError?: unknown }).clerkError === true
  );
}

function codeForStatus(status: number | undefined, clerkCode: string): IdentityProviderErrorCode {
  // No status: the request never got an answer (network error, timeout), which the SDK reports as
  // `unexpected_error` without a status.
  if (status === undefined) return 'unavailable';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'unavailable';
  return CONFLICT_CODE.test(clerkCode) ? 'conflict' : 'invalid';
}

/**
 * Maps anything a Clerk call threw onto identity-core's one error type: HTTP statuses and Clerk error codes
 * of the Backend API, token verification failures, network errors. Never returns a raw SDK error, and its
 * message never holds a token or a key (Clerk's messages do not either).
 */
export function toIdentityError(
  error: unknown,
  operation: string,
  defaultRetryAfterMs = DEFAULT_RETRY_AFTER_MS,
) {
  if (error instanceof IdentityProviderError) return error;
  if (isClerkApiError(error)) {
    const first = error.errors?.[0];
    const clerkCode = first?.code ?? '';
    const code = codeForStatus(error.status, clerkCode);
    const detail = first?.longMessage ?? first?.message ?? 'no details';
    const message = `clerk: ${operation} failed (${error.status ?? 'no response'}${clerkCode ? ` ${clerkCode}` : ''}): ${detail}`;
    if (code !== 'rate_limited') return new IdentityProviderError(code, message, { cause: error });
    const retryAfterMs =
      typeof error.retryAfter === 'number' && error.retryAfter >= 0
        ? error.retryAfter * 1000
        : defaultRetryAfterMs;
    return new IdentityProviderError(code, message, { cause: error, retryAfterMs });
  }
  if (error instanceof TokenVerificationError) {
    const code = UNAVAILABLE_TOKEN_REASONS.has(error.reason) ? 'unavailable' : 'unauthorized';
    return new IdentityProviderError(code, `clerk: ${operation}: ${error.reason}`, { cause: error });
  }
  // Network failures (fetch failed, aborted, timed out) and anything unexpected: the call may work later.
  const reason = error instanceof Error ? error.message : String(error);
  return new IdentityProviderError('unavailable', `clerk: ${operation} failed: ${reason}`, { cause: error });
}
