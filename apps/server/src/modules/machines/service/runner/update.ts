import { diffFields, type Machine, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { INSTALL_PORT } from '@mwc/shared/ports';
import { type RunnerUpdate, updateErrorCode } from '@mwc/shared/runner-protocol';
import { machinesRepo } from '../../repo.ts';
import { liveWork, machineBusy, workAnUpdateEnds } from '../../rules/jobs.ts';
import { isPowered } from '../../rules/power.ts';
import {
  manualUpdate,
  runnerBusy,
  type UnsupportedUpdate,
  updateFailed,
  updateUnsupported,
} from '../../rules/runner.ts';
import { MACHINE_NOT_FOUND, MACHINE_OFFLINE, type Refusal } from '../../rules.ts';
import type { RunnerUpdatePath } from '../../schemas/update.ts';
import type { JobLease, MachineJobs } from '../jobs.ts';
import type { PowerControl } from '../power/control.ts';
import { HubError, type ReplyTo, type RunnerHub } from './hub.ts';
import { type RebuildDeps, startRebuild } from './rebuild.ts';

/**
 * Updating a machine's runner with one click (docs/machines.md, "Updating a runner"): a connected runner that updates
 * itself (`caps.selfUpdate`) is sent `runner.update` and its answer awaited (it then restarts on the new build, and
 * reconnects as usual); a devbox's runner too old for that is reinstalled by this server over SSH when it drives the
 * boxes itself, only while the box runs (it never starts one); a container is rebuilt by this server when it has the
 * Docker CLI of the computer running it (`docker_rebuild`, `rebuild.ts`: answered at once, the rebuild goes on in the
 * background); anything else is refused with the command a person runs.
 * Each update carried out is an audit row: who, which machine, which path. One job at a time per machine (`jobs`): an
 * update is refused while an install or another update runs, and while chat turns or terminals run on the machine
 * (they would end with the restart) unless forced; it holds the machine until its runner is back on the new build.
 */

/** How long a runner has to answer `runner.update`: it downloads the bundle and the PTY first. */
export const SELF_UPDATE_TIMEOUT_MS = 3 * 60_000;

export interface UpdateDeps {
  readonly hub: RunnerHub;
  readonly control: PowerControl;
  /** The API's address (the commands a person runs) and this server's own port (the SSH reinstall's forward). */
  readonly apiUrl: string;
  readonly apiPort: number;
  /** The compose file's absolute path for a container's rebuild command; null in production (run in the repo). */
  readonly composeFile: string | null;
  /** The machines' maintenance lock. */
  readonly jobs: MachineJobs;
  /** How long a runner has to answer `runner.update`; `SELF_UPDATE_TIMEOUT_MS` unless a test shortens it. */
  readonly timeoutMs?: number;
  /** This computer's Docker CLI (MWC_LOCAL_DOCKER), which rebuilds container runners; none: their command is shown. */
  readonly docker?: RebuildDeps['docker'] | undefined;
  readonly logger?: RebuildDeps['logger'];
  /** How long a container's rebuild may take; `REBUILD_TIMEOUT_MS` unless a test shortens it. */
  readonly rebuildTimeoutMs?: number;
}

/** Who asks for the update. */
export interface UpdateCaller {
  readonly principalId: string;
  readonly requestId: string;
}

/** What was done: the path, and the build the runner restarts on when it said. */
export interface Updated {
  readonly ok: true;
  readonly path: RunnerUpdatePath;
  readonly build: string | null;
  /** A container's rebuild goes on after the answer, holding the lease, and audits itself: resolves once it ended. */
  readonly ended?: Promise<void>;
}

export type UpdateOutcome = Updated | Refusal<404> | Refusal<409> | UnsupportedUpdate | Refusal<502>;

const repo = machinesRepo();

/** The runner's words without their code (`busy: 1 live run` reads `1 live run`). */
const wordsOf = (error: string | undefined) => (error ?? 'no reason given').replace(/^[a-z_]+: /, '');

/** `runner.update` to a connected runner; `unsupported` when it turns out it cannot (an older runner acks it unknown). */
async function selfUpdate(
  deps: UpdateDeps,
  machineId: string,
  force: boolean,
): Promise<UpdateOutcome | 'unsupported'> {
  let reply: ReplyTo<RunnerUpdate>;
  try {
    const frame: RunnerUpdate = { type: 'runner.update', cmdId: newId(), ...(force ? { force } : {}) };
    reply = await deps.hub.request(machineId, frame, { timeoutMs: deps.timeoutMs ?? SELF_UPDATE_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    return error.code === 'timeout' ? updateFailed('it did not answer in time') : MACHINE_OFFLINE;
  }
  if (reply.type === 'cmd.ack') return 'unsupported';
  if (reply.ok) return { ok: true, path: 'self_update', build: reply.build ?? null };
  const code = updateErrorCode(reply.error);
  if (code === 'unsupported') return 'unsupported';
  if (code === 'busy') return runnerBusy(wordsOf(reply.error));
  return updateFailed(wordsOf(reply.error));
}

/** True when the devbox runs now, as its controller reads it (never started for this). */
async function boxRuns(control: PowerControl, t: TenantDb, machine: Machine): Promise<boolean> {
  const controller = await control.resolve(t, machine);
  if (!controller.ok) return false;
  const read = await controller.run('status');
  return read.ok && read.reading.status === 'running';
}

/** The SSH reinstall of a devbox's runner by this server, while the box runs. */
async function sshReinstall(
  deps: UpdateDeps,
  reinstall: NonNullable<PowerControl['reinstall']>,
  t: TenantDb,
  machine: Machine,
  online: boolean,
): Promise<UpdateOutcome> {
  if (!online && !(await boxRuns(deps.control, t, machine))) return MACHINE_OFFLINE;
  const done = await reinstall(machine, { apiPort: deps.apiPort, installPort: INSTALL_PORT });
  return done.ok ? { ok: true, path: 'ssh_reinstall', build: null } : updateFailed(done.error);
}

/** The audit row of an update carried out: who, which machine, which path, the new build when said. */
async function audit(t: TenantDb, caller: UpdateCaller, machineId: string, done: Updated): Promise<void> {
  await repo.audit(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'machine',
    entityId: machineId,
    action: 'runner_update',
    changes: diffFields(null, { runnerUpdate: done.path, runnerBuild: done.build }),
  });
}

/** A container's rebuild by this server: started (it audits itself once compose is done), or why not. */
async function dockerRebuild(
  deps: UpdateDeps & { readonly docker: RebuildDeps['docker'] },
  t: TenantDb,
  caller: UpdateCaller,
  machine: Machine,
  lease: JobLease,
): Promise<UpdateOutcome> {
  const done: Updated = { ok: true, path: 'docker_rebuild', build: null };
  const started = await startRebuild(
    deps,
    machine,
    deps.hub.connected(machine.id),
    lease,
    () => audit(t, caller, machine.id, done),
    manualUpdate(machine, deps),
  );
  return started.ok ? { ...done, ended: started.ended } : started;
}

/** The update by the first path that applies, the lease following the path it goes on. */
async function carryOut(
  deps: UpdateDeps,
  t: TenantDb,
  caller: UpdateCaller,
  machine: Machine,
  lease: JobLease,
  force: boolean,
): Promise<UpdateOutcome> {
  const { docker } = deps;
  if (machine.kind === 'container' && docker !== undefined) {
    return dockerRebuild({ ...deps, docker }, t, caller, machine, lease);
  }
  const runner = deps.hub.connected(machine.id);
  let outcome: UpdateOutcome | 'unsupported' = 'unsupported';
  if (runner?.caps.selfUpdate) outcome = await selfUpdate(deps, machine.id, force);
  if (outcome !== 'unsupported') return outcome;
  const { reinstall } = deps.control;
  if (isPowered(machine) && reinstall !== undefined) {
    lease.path('ssh_reinstall');
    return sshReinstall(deps, reinstall, t, machine, runner !== undefined);
  }
  return runner === undefined ? MACHINE_OFFLINE : updateUnsupported(manualUpdate(machine, deps));
}

/**
 * The update of a machine's runner by the path that applies, audited when it was carried out; refused while another job
 * runs on the machine, or while terminals (or chat turns its restart would end: an older runner's, a container's) run
 * on it unless `force`.
 */
export async function updateRunner(
  deps: UpdateDeps,
  t: TenantDb,
  caller: UpdateCaller,
  machineId: string,
  options: { readonly force?: boolean } = {},
): Promise<UpdateOutcome> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const path = firstPath(deps, machine);
  const taken = deps.jobs.take(machine.id, { kind: 'runner_update', path });
  if (!taken.ok) return machineBusy(taken.running);
  const { lease } = taken;
  const force = options.force === true;
  const reattach = deps.hub.connected(machine.id)?.caps.reattach === true;
  const live = force ? undefined : liveWork(workAnUpdateEnds(deps.hub.live(machine.id), path, reattach));
  if (live !== undefined) {
    lease.release();
    return live;
  }
  let outcome: UpdateOutcome | undefined;
  try {
    outcome = await carryOut(deps, t, caller, machine, lease, force);
  } finally {
    // A rebuild going on in the background holds the lease until it ends.
    if (outcome?.ok && outcome.ended === undefined) lease.restarting();
    else if (!outcome?.ok) lease.release();
  }
  if (outcome.ok && outcome.ended === undefined) await audit(t, caller, machine.id, outcome);
  return outcome;
}

/** The path an update starts on: a container's rebuild, the self-update, else the SSH reinstall (it may fall back). */
function firstPath(deps: UpdateDeps, machine: Machine): RunnerUpdatePath {
  if (machine.kind === 'container' && deps.docker !== undefined) return 'docker_rebuild';
  return deps.hub.connected(machine.id)?.caps.selfUpdate ? 'self_update' : 'ssh_reinstall';
}
