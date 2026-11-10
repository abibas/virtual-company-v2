import type { InstallableTool, Machine, MachineJob, MachineLive } from '../../../api/types.ts';
import { TOOL_LABELS } from '../tools/tools-text.ts';
import type { InstallState } from '../tools/use-tools.ts';
import type { RunnerUpdateState } from './RunnerUpdate.tsx';

/**
 * One maintenance job at a time per machine (docs/machines.md, "One job at a time"; pure): the job the card shows at
 * the top of Software (a container's start or stop too), and why Update runner, Install / Update and Check again wait
 * meanwhile, and why Update runner waits for the machine's chat turns and terminals.
 */

/** A job as the card knows it: the server's (`runner.job`) or one the card itself started. */
export type CardJob =
  | { readonly kind: 'tool_install'; readonly tool: InstallableTool; readonly version: string }
  | { readonly kind: 'runner_update' }
  | { readonly kind: 'container_power'; readonly action: 'start' | 'stop' };

/** The job the card shows: its line (and a rebuild's latest output line), and why the other buttons wait. */
export interface BusyJob {
  readonly label: string;
  readonly reason: string;
  readonly detail?: string | undefined;
}

/** The job the card itself started and still waits on, if any. */
export function cardJob(
  machine: Machine,
  install: InstallState,
  update: RunnerUpdateState,
): CardJob | undefined {
  if (update.kind === 'running' || update.kind === 'done') return { kind: 'runner_update' };
  if (install.kind === 'running')
    return { kind: 'tool_install', tool: install.tool, version: install.version };
  if (install.kind === 'starting') {
    return { kind: 'tool_install', tool: install.tool, version: machine.runner.toolsLatest[install.tool] };
  }
  return undefined;
}

/** The server's job as the card knows it. */
function serverJob(server: MachineJob): CardJob {
  if (server.kind === 'tool_install' && server.tool && server.version)
    return { kind: 'tool_install', tool: server.tool, version: server.version };
  if (server.kind === 'container_power' && server.action)
    return { kind: 'container_power', action: server.action };
  return { kind: 'runner_update' };
}

/**
 * The job running on the machine (the server's first, else the card's own) as the card says it; undefined for none. A
 * container's runner update is its rebuild.
 */
export function busyJob(
  server: MachineJob | null,
  own: CardJob | undefined,
  container = false,
): BusyJob | undefined {
  const job = server == null ? own : serverJob(server);
  if (job === undefined) return undefined;
  if (job.kind === 'container_power') {
    const doing = job.action === 'start' ? 'starting' : 'stopping';
    return {
      label: `${doing === 'starting' ? 'Starting' : 'Stopping'} the container…`,
      reason: `The container is ${doing}: wait for it to finish`,
    };
  }
  if (job.kind === 'runner_update' && (container || server?.path === 'docker_rebuild')) {
    return {
      label: 'Rebuilding the container with the new runner…',
      reason: 'The container is being rebuilt: wait for its runner to restart',
      detail: server?.progress,
    };
  }
  if (job.kind === 'runner_update') {
    return { label: 'Updating the runner…', reason: 'The runner is updating: wait for it to restart' };
  }
  const name = `${TOOL_LABELS[job.tool]} ${job.version}`;
  return { label: `Installing ${name}…`, reason: `${name} is being installed: wait for it to finish` };
}

const counted = (n: number, one: string) => (n > 0 ? [`${n} ${one}${n === 1 ? '' : 's'}`] : []);

/** Why Update runner waits for the machine's live work ("1 chat turn and 2 terminals are running on it…"), or undefined. */
export function liveReason(live: MachineLive | undefined): string | undefined {
  // An API that predates the count (a restart while the page is open) sends none: nothing is known to block.
  if (live === undefined) return undefined;
  const parts = [...counted(live.turns, 'chat turn'), ...counted(live.terminals, 'terminal')];
  if (parts.length === 0) return undefined;
  const one = live.turns + live.terminals === 1;
  return `${parts.join(' and ')} ${one ? 'is' : 'are'} running on it: update the runner once ${one ? 'it ends' : 'they end'}`;
}
