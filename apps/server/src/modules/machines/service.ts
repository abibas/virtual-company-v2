import { diffFields, type Machine, type TenantDb } from '@mwc/db';
import { type LogoRef, logoRef } from '@mwc/shared/logos';
import { RUNNER_CLOSE } from '@mwc/shared/runner-protocol';
import { type MachinesRepo, machinesRepo } from './repo.ts';
import { isPowered } from './rules/power.ts';
import { type RunnerFacts, runnerFacts } from './rules/runner.ts';
import {
  CONTROLLER_IS_SELF,
  CONTROLLER_NOT_FOUND,
  MACHINE_NOT_FOUND,
  NOT_A_VM,
  type Refusal,
} from './rules.ts';
import type { MachineUpdate, MachineView, TunnelView } from './schemas.ts';
import { DEFAULT_RUNNER_BUNDLE, servedBuild } from './service/download.ts';
import { machineLogoHashes } from './service/logo.ts';
import { agentCounts, removeMachinePlacements } from './service/placement.ts';
import { type ControlDeps, controlOf, type PowerControl } from './service/power/control.ts';

const iso = (at: Date | null) => at?.toISOString() ?? null;

/**
 * A machine as the API shows it, with how many agents not archived run on it by default (`agentCount`), for a devbox
 * its tunnel as its controller reported it (the power control's `tunnelOf`), its logo's version (null without one) and
 * its runner as the hub knows it (`runner`: its build against the served one).
 */
export function machineView(
  row: Machine,
  agentCount: number,
  tunnel: TunnelView | null,
  logo: LogoRef | null,
  runner: RunnerFacts,
): MachineView {
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
    runner,
    logo,
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

/** What a machine's view reads besides its rows: who drives the devboxes, the hub, the served build. */
interface Views {
  readonly control: PowerControl;
  readonly hub: ControlDeps['hub'];
  /** The build this server hands out now (the bundle's SHA-256, null unbuilt). */
  served(): Promise<string | null>;
}

/** A machine's runner as the hub knows it, against the served build. */
const runnerOf = (views: Views, row: Machine, served: string | null) =>
  runnerFacts(views.hub.connected(row.id), served);

/**
 * A machine's view with its agent count and logo, read in the caller's transaction when it is one, its tunnel and its
 * runner.
 */
const viewOf = async (views: Views, t: TenantDb, row: Machine) =>
  machineView(
    row,
    (await agentCounts(t)).get(row.id) ?? 0,
    views.control.tunnelOf(row),
    logoRef((await machineLogoHashes(t)).get(row.id)),
    runnerOf(views, row, await views.served()),
  );

/**
 * Renames a machine and/or sets (or clears) a devbox's controller; audited. After a new controller, the old one and
 * the new one get their tunnels (after the transaction).
 */
async function update(
  repo: MachinesRepo,
  views: Views,
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
    return { ok: true as const, machine: await viewOf(views, tx, row) };
  });
  for (const controllerId of moved) await views.control.syncTunnels(t, controllerId);
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
  control: PowerControl,
  hub: ControlDeps['hub'],
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
  hub.disconnect(removed.id, RUNNER_CLOSE.unauthorized, 'The machine was removed');
  if (isPowered(removed)) await control.syncTunnels(t, removed.controllerMachineId);
  return { ok: true };
}

/**
 * The machines module's reads and changes of machines (the enrollment, stats and hub are in `service/`); the runner
 * bundle it compares the runners' builds with is the one this server hands out (`runnerBundle`).
 */
export function machinesService(deps: ControlDeps & { readonly runnerBundle?: string | undefined }) {
  const repo = machinesRepo();
  const control = controlOf(deps);
  const bundle = deps.runnerBundle ?? DEFAULT_RUNNER_BUNDLE;
  const views: Views = { control, hub: deps.hub, served: () => servedBuild(bundle) };
  return {
    async list(t: TenantDb): Promise<MachineView[]> {
      const rows = await repo.list(t);
      const counts = await agentCounts(t);
      const logos = await machineLogoHashes(t);
      const served = await views.served();
      return rows.map((row) =>
        machineView(
          row,
          counts.get(row.id) ?? 0,
          control.tunnelOf(row),
          logoRef(logos.get(row.id)),
          runnerOf(views, row, served),
        ),
      );
    },

    async get(t: TenantDb, id: string): Promise<Viewed> {
      const row = await repo.get(t, id);
      return row === undefined ? MACHINE_NOT_FOUND : { ok: true, machine: await viewOf(views, t, row) };
    },

    update: (t: TenantDb, caller: Caller, id: string, change: MachineUpdate) =>
      update(repo, views, t, caller, id, change),

    remove: (t: TenantDb, caller: Caller, id: string) => remove(repo, control, deps.hub, t, caller, id),
  };
}

export type MachinesService = ReturnType<typeof machinesService>;
