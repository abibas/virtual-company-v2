import { type DbHandle, type TenantDb, tenant } from '@mwc/db';
import { AiriaDevboxRef } from '@mwc/shared/machines';
import type { TunnelSpec } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { machinesRepo } from '../../repo.ts';
import { isPowered } from '../../rules/power.ts';
import { isTunnelWanted } from '../../rules/tunnels.ts';
import type { ConnectedRunner, RunnerHub } from '../hub.ts';
import { resolveController } from './controller.ts';
import { readPower } from './store.ts';

/**
 * The devboxes' standing tunnels (docs/machines.md, "Installing a runner"): a devbox has no public address, so the
 * runner of its controller (This Mac, where this server runs) holds a reverse SSH tunnel to it that makes the box's
 * `127.0.0.1:<port>` this server's own port. Each controller gets the full set it should hold as `tunnel.set`: the
 * devboxes of its company it controls whose last known power status is running, starting or not known yet. It is sent
 * when the controller connects, after a devbox enrolls, when a box's controller, removal or power status changes, and at
 * every scheduler step; the hub sends a set only when it differs from the last one on that connection.
 */

export interface TunnelDeps {
  readonly hub: RunnerHub;
  /** The server's own listen port: both ends of every tunnel. */
  readonly port: number;
}

const repo = machinesRepo();

/** The tunnels a controller should hold now. */
export async function wantedTunnels(t: TenantDb, controllerId: string, port: number): Promise<TunnelSpec[]> {
  const tunnels: TunnelSpec[] = [];
  for (const machine of await repo.list(t)) {
    if (machine.controllerMachineId !== controllerId || !isPowered(machine)) continue;
    const ref = AiriaDevboxRef.safeParse(machine.providerRef);
    if (!ref.success) continue;
    const { state } = await readPower(t, machine.id);
    if (!isTunnelWanted(state.box?.status ?? null)) continue;
    const target = { provider: 'airia_devbox' as const, ref: ref.data };
    tunnels.push({ machineId: machine.id, target, remotePort: port, localPort: port });
  }
  return tunnels;
}

/** Sends a controller (a connected runner that powers devboxes) its tunnels; nothing for another machine or none. */
export async function syncTunnels(deps: TunnelDeps, t: TenantDb, controllerId: string | null): Promise<void> {
  if (controllerId === null || !deps.hub.connected(controllerId)?.caps.power.includes('airia_devbox')) return;
  deps.hub.tunnels.set(controllerId, await wantedTunnels(t, controllerId, deps.port));
}

type LinkDeps = TunnelDeps & { readonly db: DbHandle; readonly logger: Logger };

/** The hub's connect listener: a controller that connects gets its tunnels at once (an empty set too). */
export function tunnelsOnConnect(deps: LinkDeps): (runner: ConnectedRunner) => void {
  return (runner) => {
    if (!runner.caps.power.includes('airia_devbox')) return;
    const send = async () => syncTunnels(deps, await tenant(deps.db, runner.companyId), runner.machineId);
    send().catch((error: unknown) => {
      deps.logger.error(
        { err: error, machineId: runner.machineId },
        'power: could not send a controller its tunnels',
      );
    });
  };
}

/**
 * After a devbox enrolls: its controller (saved when exactly one connected runner of the company can power it) gets
 * the box's tunnel. A failure is logged, never the enrollment's.
 */
export async function linkEnrolledBox(deps: LinkDeps, t: TenantDb, machineId: string): Promise<void> {
  try {
    const machine = await repo.get(t, machineId);
    if (machine === undefined || !isPowered(machine)) return;
    const controller = await resolveController(t, deps.hub, machine);
    if (controller.ok) await syncTunnels(deps, t, controller.controllerId);
  } catch (error) {
    deps.logger.error({ err: error, machineId }, 'power: could not link an enrolled devbox');
  }
}
