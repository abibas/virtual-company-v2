import { ApiError } from './errors.ts';

/**
 * Riding out a server restart (`pnpm dev` restarts the API on a code change, in about a second): a call that gets no
 * answer, or the proxy's 502/503/504, is tried again a little later instead of failing at once.
 */

/** The statuses a proxy or gateway answers while the server behind it is down. */
const GATEWAY = new Set([502, 503, 504]);

/** How long the app's first reads (`/api/config` at boot, `/api/me` in the session gate) ride out a restart. */
export const BOOT_RETRY_MS = 10_000;

/** The first wait after a failure, doubled after each one up to the last. */
const FIRST_WAIT_MS = 250;
const LAST_WAIT_MS = 2000;

/** True for a failure a restarting server gives: no answer at all, or a 502/503/504 without the API's own error. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'network' || (GATEWAY.has(error.status) && error.code === 'http_error');
}

/** A run of transient failures: when it began and how long to wait before the next try. */
export interface Outage {
  readonly since: number;
  readonly waitMs: number;
}

/** The outage after one more transient failure; undefined once it has lasted `budgetMs`: stop trying then. */
export function nextOutage(
  outage: Outage | undefined,
  budgetMs: number,
  now = Date.now(),
): Outage | undefined {
  if (outage === undefined) return { since: now, waitMs: FIRST_WAIT_MS };
  if (now - outage.since >= budgetMs) return undefined;
  return { since: outage.since, waitMs: Math.min(outage.waitMs * 2, LAST_WAIT_MS) };
}

/** Calls `load`, again after each transient failure for about `budgetMs`; any other failure, or a later one, is thrown. */
export async function retryTransient<T>(load: () => Promise<T>, budgetMs: number): Promise<T> {
  let outage: Outage | undefined;
  for (;;) {
    try {
      return await load();
    } catch (error) {
      outage = isTransient(error) ? nextOutage(outage, budgetMs) : undefined;
      if (outage === undefined) throw error;
      const { waitMs } = outage;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
