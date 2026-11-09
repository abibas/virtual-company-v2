import type { Machine, TenantDb } from '@mwc/db';
import { AiriaDevboxRef } from '@mwc/shared/machines';
import type { TunnelSpec } from '@mwc/shared/runner-protocol';
import { machinesRepo } from '../../repo.ts';
import { isPowered } from '../../rules/power.ts';
import { isTunnelWanted } from '../../rules/tunnels.ts';
import type { TunnelView } from '../../schemas.ts';
import type { RunnerHub } from '../runner/hub.ts';
import { readPower } from './store.ts';

/**
 * The devboxes' standing tunnels (docs/machines.md, "Installing a runner"): a devbox has no public address, so its
 * controller holds a reverse SSH tunnel to it that makes the box's `127.0.0.1:<port>` this server's own port. A tunnel
 * is wanted for a devbox not removed whose last known power status is running, starting or not known yet. Who holds it
 * is the power control's choice (`control.ts`): this server itself for every devbox of the company (`companyTunnels`),
 * or each runner controller for the boxes it controls (`wantedTunnels`, sent as `tunnel.set`). Their states are kept in
 * the hub's memory under the one who holds them (`reportedTunnel`).
 */

const repo = machinesRepo();

/** The tunnels wanted for the company's devboxes that `owns` picks. */
async function wantedOf(
  t: TenantDb,
  port: number,
  owns: (machine: Machine) => boolean,
): Promise<TunnelSpec[]> {
  const tunnels: TunnelSpec[] = [];
  for (const machine of await repo.list(t)) {
    if (!owns(machine) || !isPowered(machine)) continue;
    const ref = AiriaDevboxRef.safeParse(machine.providerRef);
    if (!ref.success) continue;
    const { state } = await readPower(t, machine.id);
    if (!isTunnelWanted(state.box?.status ?? null)) continue;
    const target = { provider: 'airia_devbox' as const, ref: ref.data };
    tunnels.push({ machineId: machine.id, target, remotePort: port, localPort: port });
  }
  return tunnels;
}

/** The tunnels a runner controller should hold now: those of the devboxes it controls. */
export function wantedTunnels(t: TenantDb, controllerId: string, port: number): Promise<TunnelSpec[]> {
  return wantedOf(t, port, (machine) => machine.controllerMachineId === controllerId);
}

/** The tunnels this server holds for the company when it drives the devboxes itself: every devbox's. */
export function companyTunnels(t: TenantDb, port: number): Promise<TunnelSpec[]> {
  return wantedOf(t, port, () => true);
}

/** A devbox's tunnel as `reporter` (its controlling machine, or this server) last reported it; null without one. */
export function reportedTunnel(hub: RunnerHub, row: Machine, reporter: string): TunnelView | null {
  const report = hub.tunnels.report(row.companyId, row.id);
  if (report?.reportedBy !== reporter) return null;
  return { state: report.state, error: report.error, since: report.since.toISOString() };
}
