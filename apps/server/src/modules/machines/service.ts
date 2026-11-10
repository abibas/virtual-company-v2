import { diffFields, type Machine, type TenantDb } from '@mwc/db';
import { logoRef } from '@mwc/shared/logos';
import { RUNNER_CLOSE } from '@mwc/shared/runner-protocol';
import { type MachinesRepo, machinesRepo } from './repo.ts';
import { failureView, jobView } from './rules/jobs.ts';
import { machineView } from './rules/machine-view.ts';
import { isPowered } from './rules/power.ts';
import { runnerFacts, type ToolsLatest } from './rules/runner.ts';
import {
  CONTROLLER_IS_SELF,
  CONTROLLER_NOT_FOUND,
  MACHINE_NOT_FOUND,
  NOT_A_VM,
  type Refusal,
} from './rules.ts';
import type { MachineUpdate, MachineView } from './schemas.ts';
import type { MachineJobs } from './service/jobs.ts';
import { machineLogoHashes } from './service/logo.ts';
import { agentCounts, removeMachinePlacements } from './service/placement.ts';
import { type ControlDeps, controlOf, type PowerControl } from './service/power/control.ts';
import { DEFAULT_RUNNER_BUNDLE, servedBuild } from './service/runner/download.ts';
import { type LatestRunner, latestRunner } from './service/runner/latest.ts';

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
  /** The latest Claude Code and Codex the runners' tools are compared with. */
  latest(): ToolsLatest;
  /** The machines' maintenance lock: the job each one runs. */
  readonly jobs: MachineJobs;
}

/** A machine's runner as the hub knows it, against the served build, with its job and its live work. */
const runnerOf = (views: Views, row: Machine, served: string | null) =>
  runnerFacts(views.hub.connected(row.id), served, row.runnerVersion, views.latest(), {
    job: jobView(views.jobs.running(row.id)),
    live: views.hub.live(row.id),
    failure: failureView(views.jobs.failure(row.id)),
  });

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
 * bundle it compares the runners' builds with is the one this server hands out (`runnerBundle`), and their tools are
 * compared with `latest` (npm's latest, else the pins: `service/tools/npm.ts`).
 */
export function machinesService(
  deps: ControlDeps & {
    readonly runnerBundle?: string | undefined;
    readonly latest: () => ToolsLatest;
    /** The machines' maintenance lock. */
    readonly machineJobs: MachineJobs;
  },
) {
  const repo = machinesRepo();
  const control = controlOf(deps);
  const bundle = deps.runnerBundle ?? DEFAULT_RUNNER_BUNDLE;
  const views: Views = {
    control,
    hub: deps.hub,
    served: () => servedBuild(bundle),
    latest: deps.latest,
    jobs: deps.machineJobs,
  };
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

    /** The runner this server hands out (`dist/runner.json` beside the bundle), null while it is not built. */
    latestRunner: (): Promise<LatestRunner | null> => latestRunner(bundle),

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
