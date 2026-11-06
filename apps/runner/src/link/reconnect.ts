import { RUNNER_CLOSE } from '@mwc/shared/runner-protocol';

/**
 * What the runner does when its socket closes (docs/runner-protocol.md, "Transport" and the close codes): it
 * reconnects forever, waiting 1 s, 2 s, 4 s … up to 60 s plus up to a fifth more at random (so runners do not all
 * come back at once after a server restart), from 1 s again once a handshake succeeds. A refused key (HTTP 401 at the
 * upgrade, or 4001) and a runner too old (4003) stop it: neither gets better by trying again. A newer connection of
 * the same machine (4004) ends the link without stopping the process, so two copies never take turns replacing each
 * other.
 */

export const RECONNECT_INITIAL_MS = 1_000;
export const RECONNECT_MAX_MS = 60_000;
/** The jitter: up to this share of the delay, added. */
export const RECONNECT_JITTER = 0.2;

/** The wait before reconnect attempt `attempt` (0 for the first after a handshake), with `random()` in [0, 1). */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_INITIAL_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + RECONNECT_JITTER * Math.min(1, Math.max(0, random()))));
}

/** Why the link ended for good. */
export type LinkEndReason = 'stopped' | 'unauthorized' | 'too_old' | 'replaced';

export type CloseDecision =
  | { readonly kind: 'reconnect'; readonly slowest: boolean }
  | { readonly kind: 'end'; readonly reason: Exclude<LinkEndReason, 'stopped'> };

/** What a close means: its code, and the HTTP status when the upgrade was refused. */
export function closeDecision(code: number, httpStatus?: number): CloseDecision {
  if (httpStatus === 401 || code === RUNNER_CLOSE.unauthorized)
    return { kind: 'end', reason: 'unauthorized' };
  if (code === RUNNER_CLOSE.runnerTooOld) return { kind: 'end', reason: 'too_old' };
  if (code === RUNNER_CLOSE.replaced) return { kind: 'end', reason: 'replaced' };
  // A protocol the server does not speak will not change soon: try again at the slowest pace.
  return { kind: 'reconnect', slowest: code === RUNNER_CLOSE.unsupportedProtocol };
}
