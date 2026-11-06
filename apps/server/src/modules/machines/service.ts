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
import type { MachineUpdate, MachineView } from './schemas.ts';
import type { RunnerHub } from './service/hub.ts';

const iso = (at: Date | null) => at?.toISOString() ?? null;

/** A machine as the API shows it. */
export function machineView(row: Machine): MachineView {
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

/** Renames a machine and/or sets (or clears) a devbox's controller; audited. */
async function update(
  repo: MachinesRepo,
  t: TenantDb,
  caller: Caller,
  id: string,
  change: MachineUpdate,
): Promise<Viewed | Refusal<422>> {
  return t.transaction(async (tx) => {
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
    return { ok: true as const, machine: machineView(row) };
  });
}

/**
 * Removes a machine: it is gone from every list and read, its runner keys are revoked (its runner is refused from now
 * on), its socket is closed (4001) and it is offline; its sessions and samples stay for the history. Audited.
 */
async function remove(
  repo: MachinesRepo,
  hub: RunnerHub,
  t: TenantDb,
  caller: Caller,
  id: string,
): Promise<{ readonly ok: true } | Refusal> {
  const removed = await t.transaction(async (tx) => {
    const machine = await repo.get(tx, id);
    if (machine === undefined) return undefined;
    const row = (await repo.update(tx, machine.id, { removedAt: caller.now, status: 'offline' })) as Machine;
    const changes = diffFields({ removedAt: null }, { removedAt: row.removedAt });
    await repo.audit(tx, { ...userEntry(caller, 'machine', row.id, 'delete'), changes });
    for (const key of await repo.revokeRunnerKeys(tx, row.id, caller.now)) {
      const revoked = diffFields({ revokedAt: null }, { revokedAt: key.revokedAt });
      await repo.audit(tx, { ...userEntry(caller, 'api_key', key.id, 'revoke'), changes: revoked });
    }
    return row;
  });
  if (removed === undefined) return MACHINE_NOT_FOUND;
  hub.disconnect(removed.id, RUNNER_CLOSE.unauthorized, 'The machine was removed');
  return { ok: true };
}

/** The machines module's reads and changes of machines (the enrollment, stats and hub are in `service/`). */
export function machinesService(deps: { readonly hub: RunnerHub }) {
  const repo = machinesRepo();
  return {
    list: async (t: TenantDb) => (await repo.list(t)).map(machineView),

    async get(t: TenantDb, id: string): Promise<Viewed> {
      const row = await repo.get(t, id);
      return row === undefined ? MACHINE_NOT_FOUND : { ok: true, machine: machineView(row) };
    },

    update: (t: TenantDb, caller: Caller, id: string, change: MachineUpdate) =>
      update(repo, t, caller, id, change),

    remove: (t: TenantDb, caller: Caller, id: string) => remove(repo, deps.hub, t, caller, id),
  };
}

export type MachinesService = ReturnType<typeof machinesService>;
