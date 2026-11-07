import { diffFields, type Machine, type TenantDb } from '@mwc/db';
import { RUNNER_CLOSE } from '@mwc/shared/runner-protocol';
import { type MachinesRepo, machinesRepo } from './repo.ts';
import { isPowered } from './rules/power.ts';
import {
  CONTROLLER_IS_SELF,
  CONTROLLER_NOT_FOUND,
  MACHINE_NOT_FOUND,
  NOT_A_VM,
  type Refusal,
} from './rules.ts';
import type { MachineUpdate, MachineView, TunnelView } from './schemas.ts';
import type { RunnerHub } from './service/hub.ts';
import { agentCounts, removeMachinePlacements } from './service/placement.ts';
import { syncTunnels, type TunnelDeps } from './service/power/tunnels.ts';

const iso = (at: Date | null) => at?.toISOString() ?? null;

/** A devbox's tunnel as its saved controller last reported it; null for any other machine, or with no such report. */
export function tunnelOf(hub: RunnerHub, row: Machine): TunnelView | null {
  if (!isPowered(row) || row.controllerMachineId === null) return null;
  const report = hub.tunnels.report(row.companyId, row.id);
  if (report?.reportedBy !== row.controllerMachineId) return null;
  return { state: report.state, error: report.error, since: report.since.toISOString() };
}

/**
 * A machine as the API shows it, with how many agents not archived run on it by default (`agentCount`) and, for a
 * devbox, its tunnel (`tunnelOf`).
 */
export function machineView(row: Machine, agentCount: number, tunnel: TunnelView | null): MachineView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    providerRef: row.providerRef ?? null,
    controllerMachineId: row.controllerMachineId,
    os: row.os,
    arch: row.arch,
    hostname: row.hostname,
    unixUser: row.unixUser,
    versions: { runner: row.runnerVersion, claude: row.claudeVersion },
    slots: row.slots,
    status: row.status,
    lastSeenAt: iso(row.lastSeenAt),
    hold: { until: iso(row.holdUntil), source: row.holdSource },
    hourlyCost: row.hourlyCost,
    agentCount,
    tunnel,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Who acts, from the route's membership, the request id and the clock. */
export interface Caller {
  readonly principalId: string;
  readonly requestId: string;
  readonly now: Date;
}

type Viewed = { readonly ok: true; readonly machine: MachineView } | Refusal;

const userEntry = (caller: Caller, entityType: string, entityId: string, action: string) => ({
  actorKind: 'user' as const,
  actorPrincipalId: caller.principalId,
  requestId: caller.requestId,
  entityType,
  entityId,
  action,
});

/** Why a machine cannot get this controller (only a devbox, a machine of the company, never itself), or undefined. */
async function controllerRefusal(
  repo: MachinesRepo,
  t: TenantDb,
  machine: Machine,
  controllerId: string | null | undefined,
): Promise<Refusal<422> | undefined> {
  if (controllerId === undefined || controllerId === null) return undefined;
  if (!isPowered(machine)) return NOT_A_VM;
  if (controllerId === machine.id) return CONTROLLER_IS_SELF;
  return (await repo.get(t, controllerId)) === undefined ? CONTROLLER_NOT_FOUND : undefined;
}

/** A machine's view with its agent count, read in the caller's transaction when it is one, and its tunnel. */
const viewOf = async (hub: RunnerHub, t: TenantDb, row: Machine) =>
  machineView(row, (await agentCounts(t)).get(row.id) ?? 0, tunnelOf(hub, row));

/**
 * Renames a machine and/or sets (or clears) a devbox's controller; audited. After a new controller, the old one and
 * the new one get their tunnels (after the transaction).
 */
async function update(
  repo: MachinesRepo,
  deps: TunnelDeps,
  t: TenantDb,
  caller: Caller,
  id: string,
  change: MachineUpdate,
): Promise<Viewed | Refusal<422>> {
  let moved: readonly (string | null)[] = [];
  const result = await t.transaction(async (tx) => {
    const before = await repo.get(tx, id);
    if (before === undefined) return MACHINE_NOT_FOUND;
    const refusal = await controllerRefusal(repo, tx, before, change.controllerMachineId);
    if (refusal !== undefined) return refusal;
    const set = {
      ...(change.name === undefined ? {} : { name: change.name }),
      ...(change.controllerMachineId === undefined
        ? {}
        : { controllerMachineId: change.controllerMachineId }),
    };
    const row = (await repo.update(tx, before.id, set)) as Machine;
    const fields = (machine: Machine) => ({
      name: machine.name,
      controllerMachineId: machine.controllerMachineId,
    });
    const changes = diffFields(fields(before), fields(row));
    await repo.audit(tx, { ...userEntry(caller, 'machine', row.id, 'update'), changes });
    if (row.controllerMachineId !== before.controllerMachineId) {
      moved = [before.controllerMachineId, row.controllerMachineId];
    }
    return { ok: true as const, machine: await viewOf(deps.hub, tx, row) };
  });
  for (const controllerId of moved) await syncTunnels(deps, t, controllerId);
  return result;
}

/**
 * Removes a machine: it is gone from every list and read, its runner keys are revoked (its runner is refused from now
 * on), the agents' placements on it are deleted, its socket is closed (4001) and it is offline; its sessions and
 * samples stay for the history. Audited, under the company's lock (so no placement onto it is set meanwhile). A
 * devbox's controller then drops its tunnel.
 */
async function remove(
  repo: MachinesRepo,
  deps: TunnelDeps,
  t: TenantDb,
  caller: Caller,
  id: string,
): Promise<{ readonly ok: true } | Refusal> {
  const removed = await t.transaction(async (tx) => {
    await tx.lockCompany();
    const machine = await repo.get(tx, id);
    if (machine === undefined) return undefined;
    const row = (await repo.update(tx, machine.id, { removedAt: caller.now, status: 'offline' })) as Machine;
    const changes = diffFields({ removedAt: null }, { removedAt: row.removedAt });
    await repo.audit(tx, { ...userEntry(caller, 'machine', row.id, 'delete'), changes });
    for (const key of await repo.revokeRunnerKeys(tx, row.id, caller.now)) {
      const revoked = diffFields({ revokedAt: null }, { revokedAt: key.revokedAt });
      await repo.audit(tx, { ...userEntry(caller, 'api_key', key.id, 'revoke'), changes: revoked });
    }
    await removeMachinePlacements(tx, caller, row.id);
    return row;
  });
  if (removed === undefined) return MACHINE_NOT_FOUND;
  deps.hub.disconnect(removed.id, RUNNER_CLOSE.unauthorized, 'The machine was removed');
  if (isPowered(removed)) await syncTunnels(deps, t, removed.controllerMachineId);
  return { ok: true };
}

/** The machines module's reads and changes of machines (the enrollment, stats and hub are in `service/`). */
export function machinesService(deps: TunnelDeps) {
  const repo = machinesRepo();
  return {
    async list(t: TenantDb): Promise<MachineView[]> {
      const rows = await repo.list(t);
      const counts = await agentCounts(t);
      return rows.map((row) => machineView(row, counts.get(row.id) ?? 0, tunnelOf(deps.hub, row)));
    },

    async get(t: TenantDb, id: string): Promise<Viewed> {
      const row = await repo.get(t, id);
      return row === undefined ? MACHINE_NOT_FOUND : { ok: true, machine: await viewOf(deps.hub, t, row) };
    },

    update: (t: TenantDb, caller: Caller, id: string, change: MachineUpdate) =>
      update(repo, deps, t, caller, id, change),

    remove: (t: TenantDb, caller: Caller, id: string) => remove(repo, deps, t, caller, id),
  };
}

export type MachinesService = ReturnType<typeof machinesService>;
