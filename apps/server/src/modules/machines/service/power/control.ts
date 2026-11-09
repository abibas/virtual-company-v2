import { type DbHandle, type Machine, type TenantDb, tenant } from '@mwc/db';
import type { PowerAction } from '@mwc/shared/machines';
import type { PowerArgs } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { LocalPower, ReinstallPorts } from '../../../../platform/power/local.ts';
import type { RunOutcome } from '../../../../platform/power/reinstall.ts';
import { machinesRepo } from '../../repo.ts';
import { isPowered } from '../../rules/power.ts';
import type { Refusal } from '../../rules.ts';
import type { PowerControllerView } from '../../schemas/power.ts';
import type { TunnelView } from '../../schemas.ts';
import type { ConnectedRunner, RunnerHub } from '../hub.ts';
import { runnerControl } from './control/runners.ts';
import { serverControl } from './control/server.ts';
import type { Controlled } from './controller.ts';

/**
 * Who drives the devboxes (docs/machines.md, "The choice"): the one seam the power service, the scheduler, the machines'
 * views and the tunnels ask. When this server has its own driver (`LocalPower`: the airia CLI and gcloud of the
 * computer it runs on, MWC_LOCAL_POWER) it is the controller of every devbox of every company it serves: commands run
 * in-process and it holds the boxes' tunnels, while runner controllers get an empty `tunnel.set` and no
 * `power.command`. Without one (the hosted case later), each box's runner controller does both through the hub. Never
 * both.
 */

/** A devbox's controller, ready to run commands on it. */
export interface Controller {
  readonly ok: true;
  /** The controlling machine; null when this server drives the box itself. */
  readonly machineId: string | null;
  /** One power command on the box, with its timeout; the reading after it, or why it failed. */
  run(action: PowerAction, args?: PowerArgs): Promise<Controlled>;
}

export interface PowerControl {
  /** `server`: this server drives every devbox; `runners`: their runner controllers do. */
  readonly kind: 'server' | 'runners';
  /** The devbox's controller now, or why there is none (`not_a_vm`, `no_controller`, `controller_offline`). */
  resolve(t: TenantDb, machine: Machine): Promise<Controller | Refusal<409> | Refusal<422>>;
  /**
   * Brings the tunnels in step after a change in the company that may concern `machineId` (a controller, or null): a
   * runner controller's set is sent again (only when it changed); this server's own set for the company is held again
   * and a runner controller gets an empty set.
   */
  syncTunnels(t: TenantDb, machineId: string | null): Promise<void>;
  /** Who drives the machine, as the power API shows it; null for none (and for a machine that is not a devbox). */
  describe(t: TenantDb, machine: Machine): Promise<PowerControllerView | null>;
  /** The machine's tunnel as its current controller reported it; null for none. */
  tunnelOf(row: Machine): TunnelView | null;
  /** Stops what it holds (this server's tunnels): the server's shutdown. */
  close(): Promise<void>;
  /**
   * Reinstalls a devbox's runner over SSH (its install without a token), when this server drives the boxes itself; the
   * runner controllers' control has none.
   */
  readonly reinstall?: (machine: Machine, ports: ReinstallPorts) => Promise<RunOutcome>;
}

/** The control's needs: the hub, the server's port (both ends of every tunnel), the logger and its own driver, if any. */
export interface PowerControlDeps {
  readonly hub: RunnerHub;
  readonly port: number;
  readonly logger: Logger;
  readonly local?: LocalPower | undefined;
}

/** This server's control when it has its own driver, else its runner controllers'. */
export function createPowerControl(deps: PowerControlDeps): PowerControl {
  return deps.local === undefined ? runnerControl(deps) : serverControl({ ...deps, local: deps.local });
}

/** The deps of code that may be given a control: without one, the runner controllers' (no tunnels without a port). */
export interface ControlDeps {
  readonly hub: RunnerHub;
  readonly port?: number | undefined;
  readonly control?: PowerControl | undefined;
}

export const controlOf = (deps: ControlDeps): PowerControl => deps.control ?? runnerControl(deps);

type LinkDeps = ControlDeps & { readonly db: DbHandle; readonly logger: Logger };

/** The hub's connect listener: a runner that can power devboxes gets its tunnels at once (an empty set too). */
export function tunnelsOnConnect(deps: LinkDeps): (runner: ConnectedRunner) => void {
  const control = controlOf(deps);
  return (runner) => {
    if (!runner.caps.power.includes('airia_devbox')) return;
    const send = async () => control.syncTunnels(await tenant(deps.db, runner.companyId), runner.machineId);
    send().catch((error: unknown) => {
      deps.logger.error(
        { err: error, machineId: runner.machineId },
        'power: could not send a controller its tunnels',
      );
    });
  };
}

/**
 * After a devbox enrolls: its controller (this server, or the runner saved when exactly one connected runner of the
 * company can power it) holds the box's tunnel. A failure is logged, never the enrollment's.
 */
export async function linkEnrolledBox(deps: LinkDeps, t: TenantDb, machineId: string): Promise<void> {
  try {
    const control = controlOf(deps);
    const machine = await machinesRepo().get(t, machineId);
    if (machine === undefined || !isPowered(machine)) return;
    const controller = await control.resolve(t, machine);
    if (controller.ok) await control.syncTunnels(t, controller.machineId);
  } catch (error) {
    deps.logger.error({ err: error, machineId }, 'power: could not link an enrolled devbox');
  }
}
