import type { LimitWindow, UsageError } from '../../schemas/limits.ts';

/**
 * Where the limits checks keep what they found (S3.3), per credential: when it was last checked, that check's
 * refusal (null when it worked), the last good windows, which a failed check keeps showing, and after a provider's
 * 429 how many came in a row and when the next check may run. A port, so a shared store can replace the process's
 * memory when the server runs as several processes; today it is `memoryUsageCache()`. Keys are credential ids: the
 * limits service only asks for the caller's own credentials.
 */
export interface UsageEntry {
  readonly checkedAt: Date;
  readonly error: UsageError | null;
  readonly lastGood: { readonly windows: readonly LimitWindow[]; readonly checkedAt: Date } | null;
  /** No check before this time: the provider's `Retry-After`, else the backoff. Null when not rate limited. */
  readonly retryAt?: Date | null;
  /** The 429s in a row, for the backoff; 0 (or absent) after any other outcome. */
  readonly rateLimits?: number;
}

export interface UsageCache {
  get(credentialId: string): Promise<UsageEntry | undefined>;
  set(credentialId: string, entry: UsageEntry): Promise<void>;
}

/** The cache in this process's memory: lost on a restart, which costs one check per subscription. */
export function memoryUsageCache(): UsageCache {
  const entries = new Map<string, UsageEntry>();
  return {
    get: async (credentialId) => entries.get(credentialId),
    set: async (credentialId, entry) => {
      entries.set(credentialId, entry);
    },
  };
}
