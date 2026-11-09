import type { TenantDb } from '@mwc/db';
import { machinesRepo } from '../../../repo.ts';
import { isPowered } from '../../../rules/power.ts';
import type { RunnerHub } from '../../runner/hub.ts';
import type { PowerControl } from '../control.ts';
import { command, resolveController } from '../controller.ts';
import { reportedTunnel, wantedTunnels } from '../tunnels.ts';

/**
 * The runner controllers' control (this server has no airia CLI of its own): each devbox is powered by the runner of
 * its controller (`controller.ts`, saved when exactly one connected runner of the company can power it), through the
 * hub, and that runner holds its tunnel from the `tunnel.set` it is sent (`tunnels.ts`). Without the server's port no
 * set is sent (a scheduler made without one).
 */

const repo = machinesRepo();

/** Sends a controller (a connected runner that powers devboxes) its tunnels; nothing for another machine or none. */
async function sendTunnels(hub: RunnerHub, port: number, t: TenantDb, controllerId: string): Promise<void> {
  if (!hub.connected(controllerId)?.caps.power.includes('airia_devbox')) return;
  hub.tunnels.set(controllerId, await wantedTunnels(t, controllerId, port));
}

export function runnerControl(deps: {
  readonly hub: RunnerHub;
  readonly port?: number | undefined;
}): PowerControl {
  const { hub, port } = deps;
  return {
    kind: 'runners',
    async resolve(t, machine) {
      const controller = await resolveController(t, hub, machine);
      if (!controller.ok) return controller;
      const { controllerId } = controller;
      return {
        ok: true,
        machineId: controllerId,
        run: (action, args) => command(hub, controllerId, machine, action, args ? { args } : {}),
      };
    },
    async syncTunnels(t, machineId) {
      if (machineId !== null && port !== undefined) await sendTunnels(hub, port, t, machineId);
    },
    async describe(t, machine) {
      if (machine.controllerMachineId === null) return null;
      const controller = await repo.get(t, machine.controllerMachineId);
      if (controller === undefined) return null;
      const { id, name } = controller;
      return { kind: 'machine', machineId: id, name, online: hub.isOnline(id) };
    },
    tunnelOf(row) {
      if (!isPowered(row) || row.controllerMachineId === null) return null;
      return reportedTunnel(hub, row, row.controllerMachineId);
    },
    close: async () => {},
  };
}
