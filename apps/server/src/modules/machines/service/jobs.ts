import type { InstallableTool } from '@mwc/shared/machines';
import type { MachineJob } from '../rules/jobs.ts';
import type { RunnerUpdatePath } from '../schemas/update.ts';

/**
 * The machines' maintenance lock (docs/machines.md, "One job at a time"), in memory (one server process): at most one
 * job per machine, an install of a CLI or an update of its runner. A job is taken before it starts and released when it
 * ends: an install with its result, failure or timeout (the runner going away fails it); a runner update that failed or
 * was refused at once, and one that was carried out once its runner reconnects on the new build, or `RESTART_WAIT_MS`
 * after it answered. A server restart forgets the lock.
 */

/** How long a runner update that was carried out holds the machine while its runner restarts and reconnects. */
export const RESTART_WAIT_MS = 3 * 60_000;

/** A job to take: what it does (its start time is the lock's). */
export type NewJob =
  | { readonly kind: 'tool_install'; readonly tool: InstallableTool; readonly version: string }
  | { readonly kind: 'runner_update'; readonly path: RunnerUpdatePath };

/** A job taken: its holder changes its path, waits for the restart, or releases it (each only while it holds it). */
export interface JobLease {
  /** The path the update goes on by now (a self-update that falls back to the SSH reinstall). */
  path(path: RunnerUpdatePath): void;
  /** The update was carried out: the lock waits for the runner to reconnect (or for `RESTART_WAIT_MS`). */
  restarting(): void;
  release(): void;
}

interface Held {
  job: MachineJob;
  /** When the lock gives up waiting for the restart (ms); null while the job runs. */
  restartBy: number | null;
  /** The runner reconnected while the update ran (the SSH reinstall restarts it before it returns). */
  reconnected: boolean;
}

export function machineJobs(clock: () => Date, options: { readonly restartWaitMs?: number } = {}) {
  const held = new Map<string, Held>();
  const restartWaitMs = options.restartWaitMs ?? RESTART_WAIT_MS;
  const current = (machineId: string): Held | undefined => {
    const one = held.get(machineId);
    if (one !== undefined && one.restartBy !== null && clock().getTime() >= one.restartBy)
      held.delete(machineId);
    return held.get(machineId);
  };
  const lease = (machineId: string, mine: Held): JobLease => {
    const holds = () => held.get(machineId) === mine;
    return {
      path(path) {
        if (holds() && mine.job.kind === 'runner_update') mine.job = { ...mine.job, path };
      },
      restarting() {
        if (!holds()) return;
        if (mine.reconnected) held.delete(machineId);
        else mine.restartBy = clock().getTime() + restartWaitMs;
      },
      release() {
        if (holds()) held.delete(machineId);
      },
    };
  };
  return {
    /** The job running on the machine, if any. */
    running: (machineId: string): MachineJob | undefined => current(machineId)?.job,
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
      return { ok: true, lease: lease(machineId, mine) };
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
