import {
  COMPOSE_FILE_RELATIVE,
  CONTAINER_RUNNER,
  containerRunnerProject,
  shellQuote,
  shellWord,
} from '@mwc/shared/container-runner';
import type { PowerStatus } from '@mwc/shared/machines';
import { type Refusal, refuse } from '../../rules.ts';
import { RUNNER_SERVICE, type RunnerContainer } from '../container.ts';

/**
 * Start and Stop of a container runner (docs/machines.md, "Starting and stopping a container"; pure): its power status
 * from Docker's state, the `docker start` / `docker stop` this server runs with their time limits, the commands a person
 * runs instead, and the refusals that name them.
 */

/** How long `docker stop` lets the runner shut down when the container does not say (compose's `stop_grace_period`). */
export const STOP_GRACE_S = 90;

/** How long `docker stop` may take past its grace period (Docker's own SIGKILL and clean-up). */
export const STOP_MARGIN_MS = 30_000;

/** How long `docker start` may take: the container exists already, so nothing is built or pulled. */
export const START_TIMEOUT_MS = 60_000;

/** The power statuses in which a Start has nothing to do. */
export const UP: readonly PowerStatus[] = ['running', 'starting'];

/**
 * The container's power status from Docker's state: `running` (`starting` while its health check has not passed yet),
 * `starting` while Docker restarts it, `stopping` while it is removed, `stopped` once it exited (or was only created);
 * `unknown` for a paused or dead one, which Start and Stop leave to Docker's own words.
 */
export function containerStatus(container: Pick<RunnerContainer, 'state' | 'health'>): PowerStatus {
  switch (container.state) {
    case 'running':
      return container.health === 'starting' ? 'starting' : 'running';
    case 'restarting':
      return 'starting';
    case 'removing':
      return 'stopping';
    case 'exited':
    case 'created':
      return 'stopped';
    default:
      return 'unknown';
  }
}

/** The grace period `docker stop` gives the runner: the container's own (compose sets it), else `STOP_GRACE_S`. */
export const graceOf = (container: Pick<RunnerContainer, 'stopTimeout'>): number =>
  container.stopTimeout !== null && container.stopTimeout > 0 ? container.stopTimeout : STOP_GRACE_S;

/** The command this server runs, with its time limit. */
export interface PowerCommand {
  readonly args: string[];
  readonly timeoutMs: number;
}

/** `docker start <id>`, or `docker stop -t <grace> <id>` with time for the runner's own shutdown. */
export function powerCommand(container: RunnerContainer, action: 'start' | 'stop'): PowerCommand {
  if (action === 'start') return { args: ['start', container.id], timeoutMs: START_TIMEOUT_MS };
  const grace = graceOf(container);
  return { args: ['stop', '-t', String(grace), container.id], timeoutMs: grace * 1000 + STOP_MARGIN_MS };
}

/** The commands a person runs on the computer running Docker: start and stop its container, or create it again. */
export interface ContainerCommands {
  readonly start: string;
  readonly stop: string;
  /** Creates the container again in its compose project (its volumes keep its enrollment), at the default limits. */
  readonly create: string;
}

/**
 * The machine's commands, in its own compose project (`mwc-runner-<slug of its name>`, as the add sheet started it) from
 * the compose file's absolute path when the server knows it. `create` has its name and runs at once, and the add sheet's
 * default CPUs and memory, since a container that is gone no longer says its own.
 */
export function containerCommands(
  machine: { readonly name: string; readonly slots: number },
  composeFile: string | null,
): ContainerCommands {
  const file = composeFile === null ? COMPOSE_FILE_RELATIVE : shellWord(composeFile);
  const compose = `docker compose -p ${containerRunnerProject(machine.name)} -f ${file} --profile runner`;
  const slots = Math.max(CONTAINER_RUNNER.slots.min, machine.slots);
  const env = [
    `MWC_RUNNER_NAME=${shellQuote(machine.name)}`,
    `MWC_RUNNER_CPUS=${CONTAINER_RUNNER.cpus.default}`,
    `MWC_RUNNER_MEMORY=${CONTAINER_RUNNER.memoryGb.default}g`,
    `MWC_RUNNER_SLOTS=${slots}`,
  ];
  return {
    start: `${compose} start ${RUNNER_SERVICE}`,
    stop: `${compose} stop ${RUNNER_SERVICE}`,
    create: `${env.join(' ')} ${compose} up -d ${RUNNER_SERVICE}`,
  };
}

/** A refusal that comes with the command to run instead. */
export interface ByHand extends Refusal<409> {
  readonly command: string;
}

const where = (composeFile: string | null) =>
  composeFile === null ? 'in the repository folder' : 'in a Terminal on the computer running Docker';

/** This server has no Docker CLI of its own (MWC_LOCAL_DOCKER): the person runs the command. */
export function powerByHand(
  action: 'start' | 'stop',
  commands: ContainerCommands,
  composeFile: string | null,
): ByHand {
  const message = `This server does not run Docker for container runners. Run this ${where(composeFile)} to ${action} it.`;
  return { ...refuse(409, 'power_unsupported', message), command: commands[action] };
}

/**
 * No container of the machine was found (by its runner's id, or in its compose project from this server's compose file):
 * a Start names the command that creates it again, a Stop the one that stops whatever runs in its project.
 */
export function containerMissing(
  action: 'start' | 'stop',
  machine: { readonly name: string },
  commands: ContainerCommands,
): ByHand {
  const found = `No container of this runner was found in the compose project ${containerRunnerProject(machine.name)}`;
  if (action === 'stop') {
    const message = `${found} started from this server's compose file. If it runs from another one, stop it there with this.`;
    return { ...refuse(409, 'container_missing', message), command: commands.stop };
  }
  const message =
    `${found}. This creates it again (its volumes keep its enrollment, unless they were removed too): its CPU and ` +
    'memory limits are the defaults, so change them in the command first if it had others.';
  return { ...refuse(409, 'container_missing', message), command: commands.create };
}
