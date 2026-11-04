import { IdentityProviderError } from '@mwc/identity-core';

/** Clerk's limit on creating invitations: 250 an hour per instance. */
export const INVITATION_LIMIT = { count: 250, windowMs: 60 * 60 * 1000 } as const;

/** What the connector rate-limits on its own: every Backend API call, and invitation creation. */
export type RateBucket = 'api' | 'invitations';

/**
 * Honors Clerk's 429s: after one, calls of that bucket (and of every bucket, after a 429 on `api`) fail
 * fast with `rate_limited` and the time left, until the Retry-After has passed, instead of hitting Clerk
 * again. Invitations also keep a local budget of `INVITATION_LIMIT` in a sliding window, so the 251st
 * invitation of the hour is refused here with the time until a slot frees up.
 */
export class RateGate {
  readonly #now: () => number;
  readonly #blockedUntil = new Map<RateBucket, number>();
  readonly #invitations: number[] = [];
  readonly #limit: { readonly count: number; readonly windowMs: number };

  constructor(now: () => number, invitationLimit: { count: number; windowMs: number } = INVITATION_LIMIT) {
    this.#now = now;
    this.#limit = invitationLimit;
  }

  /** Rejects with `rate_limited` while the bucket (or the whole API) is blocked by an earlier 429. */
  check(bucket: RateBucket): void {
    const now = this.#now();
    const until = Math.max(this.#blockedUntil.get('api') ?? 0, this.#blockedUntil.get(bucket) ?? 0);
    if (until > now) {
      throw new IdentityProviderError('rate_limited', `clerk: rate limited (${bucket}), retry later`, {
        retryAfterMs: until - now,
      });
    }
  }

  /** Records a 429: the bucket stays closed for `retryAfterMs`. */
  block(bucket: RateBucket, retryAfterMs: number): void {
    const until = this.#now() + retryAfterMs;
    this.#blockedUntil.set(bucket, Math.max(this.#blockedUntil.get(bucket) ?? 0, until));
  }

  /** Takes one invitation slot of the sliding window, or rejects with the wait until the oldest frees. */
  takeInvitation(): void {
    const now = this.#now();
    const stillCounted = this.#invitations.findIndex((at) => at > now - this.#limit.windowMs);
    this.#invitations.splice(0, stillCounted === -1 ? this.#invitations.length : stillCounted);
    if (this.#invitations.length >= this.#limit.count) {
      const oldest = Math.min(...this.#invitations);
      throw new IdentityProviderError(
        'rate_limited',
        `clerk: ${this.#limit.count} invitations in the last hour, retry later`,
        { retryAfterMs: oldest + this.#limit.windowMs - now },
      );
    }
    this.#invitations.push(now);
  }
}
