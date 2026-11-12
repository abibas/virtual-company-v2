import { retryDelayFor, TUNNEL_CLEAR_COOLDOWN_MS, TUNNEL_CLEAR_EVERY_MS } from './process.ts';

/**
 * What a tunnel that ended does next (`../tunnels.ts`, docs/machines.md "The standing tunnel"), pure. A stale session
 * of the tunnel's earlier process may still hold the machine's port (the box's sshd behind IAP notices a dead client
 * late, sometimes after an hour), so the next try would fail with ssh's forward failure: the port is cleared first
 * when ssh said so, and when the tunnel that ended had been up (its session is the one now left behind). While the
 * machine reads running a clearing runs before every such try, at most once in 20 s (the try waits for the rest of
 * that cool-down), and the backoff stops at 30 s; otherwise a clearing runs at most once in 5 minutes and the backoff
 * goes up to 5 minutes.
 */

/** A tunnel's process that just ended, as the supervisor saw it. */
export interface EndedTunnel {
  /** The machine's last power reading says it runs (`TunnelSpec.running`). */
  readonly running: boolean;
  /** It had been up (alive for 10 s). */
  readonly wasUp: boolean;
  /** ssh said the machine's port was taken. */
  readonly forward: boolean;
  /** The driver has a clearing of the machine's port for it. */
  readonly canClear: boolean;
  /** When it last cleared the machine's port (monotonic), if ever. */
  readonly clearedAt: number | undefined;
  /** Failures in a row before this one. */
  readonly failures: number;
  readonly now: number;
}

/** Clear the machine's port in `after` ms, then try again 2 s after the clearing; or try again in `after` ms. */
export type Recovery = { readonly clear: boolean; readonly after: number };

export function recovery(ended: EndedTunnel): Recovery {
  if (ended.canClear && (ended.forward || ended.wasUp)) {
    const every = ended.running ? TUNNEL_CLEAR_COOLDOWN_MS : TUNNEL_CLEAR_EVERY_MS;
    const since = ended.clearedAt === undefined ? Number.POSITIVE_INFINITY : ended.now - ended.clearedAt;
    if (since >= every) return { clear: true, after: 0 };
    if (ended.running) return { clear: true, after: every - since };
  }
  return { clear: false, after: retryDelayFor(ended.failures, ended.running) };
}

/** What the log says when a tunnel clears its machine's port: after ssh's forward failure, or after one that was up. */
export const clearingNote = (forward: boolean): string =>
  forward
    ? "a tunnel's port on the machine is taken; clearing it"
    : "a tunnel that was up ended; clearing the machine's port first";
