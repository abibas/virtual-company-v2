import type { InstallableTool } from '@mwc/shared/machines';
import type { MachineJob, UpdateFailure } from '../rules/jobs.ts';
import type { RunnerUpdatePath } from '../schemas/update.ts';

/**
 * The machines' maintenance lock (docs/machines.md, "One job at a time"), in memory (one server process): at most one
 * job per machine, an install of a CLI, an update of its runner, or a container's start or stop. A job is taken before
 * it starts and released when it ends: an install with its result, failure or timeout (the runner going away fails it);
 * a container's start or stop when Docker is done; a runner update that failed or was refused at once, and one that was
 * carried out once its runner reconnects on the new build, or `RESTART_WAIT_MS` after it answered. A container's
 * rebuild runs after its answer: it holds the machine while it builds (its last output line is the job's `progress`),
 * and one that fails is remembered (`failure`) until the next job on the machine or `FAILURE_KEPT_MS`, so the card can
 * say why. A server restart forgets the lock and the failures.
 */

/** How long a runner update that was carried out holds the machine while its runner restarts and reconnects. */
export const RESTART_WAIT_MS = 3 * 60_000;

/** How long a failed rebuild is remembered for the card. */
export const FAILURE_KEPT_MS = 30 * 60_000;

/** How much of a rebuild's output line the job keeps as its progress. */
const PROGRESS_MAX = 300;

/** A job to take: what it does (its start time is the lock's). */
export type NewJob =
  | { readonly kind: 'tool_install'; readonly tool: InstallableTool; readonly version: string }
  | { readonly kind: 'runner_update'; readonly path: RunnerUpdatePath }
  | { readonly kind: 'container_power'; readonly action: 'start' | 'stop' };

/** A job taken: its holder changes its path, waits for the restart, or releases it (each only while it holds it). */
export interface JobLease {
  /** The path the update goes on by now (a self-update that falls back to the SSH reinstall). */
  path(path: RunnerUpdatePath): void;
  /** A rebuild's latest output line, shown as the job's progress. */
  progress(line: string): void;
  /** The update was carried out: the lock waits for the runner to reconnect (or for `RESTART_WAIT_MS`). */
  restarting(): void;
  release(): void;
  /** An update that failed after its answer: released, and remembered with why and the command to run instead. */
  fail(message: string, command: string | null): void;
}

interface Held {
  job: MachineJob;
  /** When the lock gives up waiting for the restart (ms); null while the job runs. */
  restartBy: number | null;
  /** The runner reconnected while the update ran (the SSH reinstall restarts it before it returns). */
  reconnected: boolean;
}

/** The lock's state: the jobs held and the failures remembered, by machine. */
interface Lock {
  readonly held: Map<string, Held>;
  readonly failures: Map<string, UpdateFailure>;
  readonly clock: () => Date;
  readonly restartWaitMs: number;
}

/** The lease of the job `mine` on the machine: each change only while it still holds the machine. */
function leaseOf(lock: Lock, machineId: string, mine: Held): JobLease {
  const { held, clock } = lock;
  const holds = () => held.get(machineId) === mine;
  const update = (change: (job: Extract<MachineJob, { kind: 'runner_update' }>) => MachineJob) => {
    if (holds() && mine.job.kind === 'runner_update') mine.job = change(mine.job);
  };
  return {
    path: (path) => update((job) => ({ ...job, path })),
    progress: (line) => update((job) => ({ ...job, progress: line.slice(0, PROGRESS_MAX) })),
    restarting() {
      if (!holds()) return;
      if (mine.reconnected) held.delete(machineId);
      else mine.restartBy = clock().getTime() + lock.restartWaitMs;
    },
    release() {
      if (holds()) held.delete(machineId);
    },
    fail(message, command) {
      if (!holds()) return;
      held.delete(machineId);
      const path = mine.job.kind === 'runner_update' ? mine.job.path : 'docker_rebuild';
      lock.failures.set(machineId, { path, message, command, at: clock() });
    },
  };
}

export function machineJobs(clock: () => Date, options: { readonly restartWaitMs?: number } = {}) {
  const lock: Lock = {
    held: new Map(),
    failures: new Map(),
    clock,
    restartWaitMs: options.restartWaitMs ?? RESTART_WAIT_MS,
  };
  const { held, failures } = lock;
  const current = (machineId: string): Held | undefined => {
    const one = held.get(machineId);
    if (one !== undefined && one.restartBy !== null && clock().getTime() >= one.restartBy)
      held.delete(machineId);
    return held.get(machineId);
  };
  return {
    /** The job running on the machine, if any. */
    running: (machineId: string): MachineJob | undefined => current(machineId)?.job,
    /** The machine's last update that failed after its answer, while it is remembered. */
    failure(machineId: string): UpdateFailure | undefined {
      const one = failures.get(machineId);
      if (one !== undefined && clock().getTime() - one.at.getTime() >= FAILURE_KEPT_MS)
        failures.delete(machineId);
      return failures.get(machineId);
    },
    /** Takes the machine for `job`; the job running there instead when another holds it. */
    take(
      machineId: string,
      job: NewJob,
    ):
      | { readonly ok: true; readonly lease: JobLease }
      | { readonly ok: false; readonly running: MachineJob } {
      const other = current(machineId);
      if (other !== undefined) return { ok: false, running: other.job };
      const mine: Held = { job: { ...job, startedAt: clock() }, restartBy: null, reconnected: false };
      held.set(machineId, mine);
      failures.delete(machineId);
      return { ok: true, lease: leaseOf(lock, machineId, mine) };
    },
    /** The machine's runner connected (the hub's connect listener): an update waiting for it ends. */
    connected(machineId: string): void {
      const one = current(machineId);
      if (one?.job.kind !== 'runner_update') return;
      if (one.restartBy === null) one.reconnected = true;
      else held.delete(machineId);
    },
  };
}

export type MachineJobs = ReturnType<typeof machineJobs>;
