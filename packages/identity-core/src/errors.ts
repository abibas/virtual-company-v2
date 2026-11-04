/** What went wrong in a call to the identity provider; callers branch on `code`, never on messages. */
export const IDENTITY_PROVIDER_ERROR_CODES = [
  /** The organization, user, membership or invitation does not exist. */
  'not_found',
  /** The call contradicts the provider's state (a duplicate invitation, revoking an accepted one). */
  'conflict',
  /** Too many calls; wait `retryAfterMs` (the provider's Retry-After) and try again. */
  'rate_limited',
  /** A token or webhook signature that does not verify, or credentials the provider refuses. */
  'unauthorized',
  /** Input the provider rejects (a malformed email, an unknown role, a body that does not parse). */
  'invalid',
  /** The provider is down or timed out; the same call may succeed later. */
  'unavailable',
] as const;
export type IdentityProviderErrorCode = (typeof IDENTITY_PROVIDER_ERROR_CODES)[number];

export interface IdentityProviderErrorOptions {
  /** For `rate_limited`: how long the provider asked to wait, in milliseconds. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

/** The one error type every `IdentityProvider` method rejects with. */
export class IdentityProviderError extends Error {
  readonly code: IdentityProviderErrorCode;
  readonly retryAfterMs: number | undefined;

  constructor(code: IdentityProviderErrorCode, message: string, options: IdentityProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'IdentityProviderError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** `rate_limited` and `unavailable`: the same call may succeed later (the outbox retries these). */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'unavailable';
  }
}

/** True for an `IdentityProviderError`, optionally of one code. */
export function isIdentityProviderError(
  error: unknown,
  code?: IdentityProviderErrorCode,
): error is IdentityProviderError {
  return error instanceof IdentityProviderError && (code === undefined || error.code === code);
}
