import type { InstallableTool } from '@mwc/shared/machines';
import { type Refusal, refuse } from '../rules.ts';
import type { MachineJobView, MachineLiveView, RunnerUpdateFailureView } from '../schemas/jobs.ts';
import type { RunnerUpdatePath } from '../schemas/update.ts';

/**
 * One maintenance job at a time per machine (docs/machines.md, "One job at a time"; pure): the jobs, how a refusal
 * names the one running, and how a runner update (or a container's stop) refused for live work names it.
 */

/** A job holding a machine's lock: an install of a CLI, an update of its runner, or a container's start or stop. */
export type MachineJob =
  | {
      readonly kind: 'tool_install';
      readonly tool: InstallableTool;
      readonly version: string;
      readonly startedAt: Date;
    }
  | {
      readonly kind: 'runner_update';
      readonly path: RunnerUpdatePath;
      readonly startedAt: Date;
      /** A rebuild's last output line so far. */
      readonly progress?: string;
    }
  | {
      /** A container runner's container being started or stopped by this server (Start / Stop on its card). */
      readonly kind: 'container_power';
      readonly action: 'start' | 'stop';
      readonly startedAt: Date;
    };

/** A runner update that failed after its answer (a container's rebuild): why, the command to run instead, when. */
export interface UpdateFailure {
  readonly path: RunnerUpdatePath;
  readonly message: string;
  readonly command: string | null;
  readonly at: Date;
}

/** How people call the CLIs an install installs. */
export const TOOL_NAMES: Readonly<Record<InstallableTool, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/** What the running job asks of whoever comes next. */
export function jobText(job: MachineJob): string {
  if (job.kind === 'tool_install')
    return `${TOOL_NAMES[job.tool]} ${job.version} is being installed: wait for it to finish`;
  if (job.kind === 'container_power')
    return `The container is ${job.action === 'start' ? 'starting' : 'stopping'}: wait for it to finish`;
  return job.path === 'docker_rebuild'
    ? 'The container is being rebuilt: wait for its runner to restart'
    : 'The runner is updating: wait for it to restart';
}

/** Another job runs on the machine. */
export const machineBusy = (job: MachineJob): Refusal<409> => refuse(409, 'machine_busy', jobText(job));

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "2 chat turns and 1 terminal are running on it"; undefined when nothing is. */
export function liveText(live: MachineLiveView): string | undefined {
  const parts = [
    ...(live.turns > 0 ? [count(live.turns, 'chat turn')] : []),
    ...(live.terminals > 0 ? [count(live.terminals, 'terminal')] : []),
  ];
  if (parts.length === 0) return undefined;
  const many = parts.length > 1 || live.turns + live.terminals > 1;
  return `${parts.join(' and ')} ${many ? 'are' : 'is'} running on it`;
}

/**
 * A runner update (or a container's stop: `what`) refused while the machine has live work, which the restart or the stop
 * would end; undefined without any.
 */
export function liveWork(live: MachineLiveView, what = 'update the runner'): Refusal<409> | undefined {
  const words = liveText(live);
  if (words === undefined) return undefined;
  const one = live.turns + live.terminals === 1;
  return refuse(409, 'machine_busy', `${words}: ${what} once ${one ? 'it ends' : 'they end'}`);
}

/**
 * The live work a runner update would end (S5.4): a runner that keeps its turns (`caps.reattach`) keeps them through its
 * own restart (a self-update, an SSH reinstall), so only its terminals count then; a container's rebuild ends them all.
 */
export function workAnUpdateEnds(
  live: MachineLiveView,
  path: RunnerUpdatePath,
  reattach: boolean,
): MachineLiveView {
  return reattach && path !== 'docker_rebuild' ? { ...live, turns: 0 } : live;
}

/** A job as the API shows it. */
export function jobView(job: MachineJob | undefined): MachineJobView | null {
  if (job === undefined) return null;
  const startedAt = job.startedAt.toISOString();
  if (job.kind === 'tool_install') return { kind: job.kind, tool: job.tool, version: job.version, startedAt };
  if (job.kind === 'container_power') return { kind: job.kind, action: job.action, startedAt };
  return { kind: job.kind, path: job.path, startedAt, ...(job.progress ? { progress: job.progress } : {}) };
}

/** A failed update as the API shows it. */
export function failureView(failure: UpdateFailure | undefined): RunnerUpdateFailureView | null {
  if (failure === undefined) return null;
  const { path, message, command, at } = failure;
  return { path, message, command, at: at.toISOString() };
}
