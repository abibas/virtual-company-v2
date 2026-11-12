import type { PowerStatus } from '@mwc/shared/machines';
import type { TunnelSpec } from '@mwc/shared/runner-protocol';

/**
 * The devboxes' tunnels, pure (docs/machines.md, "Installing a runner"): when a box's tunnel is wanted, and what makes
 * two `tunnel.set`s the same.
 */

/** The last known power statuses with which a box is linked: up, coming up, or not known yet. */
const LINKED: ReadonlySet<PowerStatus> = new Set(['running', 'starting', 'unknown']);

/** True when the box's tunnel is wanted: its last known status is running or starting, or there is none yet. */
export function isTunnelWanted(status: PowerStatus | null): boolean {
  return status === null || LINKED.has(status);
}

/**
 * A set's identity: each tunnel's machine, what it forwards where and whether its box reads running, in machine order
 * (a box's size is left out), so a box turning running sends its controller the set again.
 */
export function tunnelSetKey(tunnels: readonly TunnelSpec[]): string {
  const rows = tunnels.map((tunnel) => [
    tunnel.machineId,
    tunnel.target.provider,
    tunnel.target.ref.instance,
    tunnel.target.ref.zone,
    tunnel.remotePort,
    tunnel.localPort,
    tunnel.running === true,
  ]);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify(rows);
}
