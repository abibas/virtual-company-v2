import type { Machine } from '@mwc/db';
import type { PowerStatus } from '@mwc/shared/machines';
import type { Logger } from 'pino';
import type { LocalDocker } from '../../../../platform/processes/docker/local.ts';
import {
  type ByHand,
  containerCommands,
  containerMissing,
  containerStatus,
  powerByHand,
  powerCommand,
  UP,
} from '../../rules/container/power.ts';
import { liveWork, machineBusy } from '../../rules/jobs.ts';
import type { Refusal } from '../../rules.ts';
import type { ContainerPowerView } from '../../schemas/power.ts';
import type { MachineJobs } from '../jobs.ts';
import type { RunnerHub } from '../runner/hub.ts';
import { findContainer } from '../runner/rebuild.ts';
import type { PowerFailure } from './controller.ts';

/**
 * Start and Stop of a container runner (docs/machines.md, "Starting and stopping a container"), when this server has the
 * Docker CLI of the computer running it (MWC_LOCAL_DOCKER): the container is found as for its rebuild (by the id its
 * runner says, else in its compose project, only one started from this server's compose file), then `docker start` or
 * `docker stop -t <its grace period>`, holding the machine's job lock while Docker works. A Stop is refused while chat
 * turns or terminals run on the machine unless forced (the stop ends them). Without Docker, or without its container,
 * the refusal names the command a person runs. The power service logs what was done (`machine_power_events`).
 */

export interface ContainerPowerDeps {
  /** This computer's Docker CLI; none: Start and Stop are refused with the command to run. */
  readonly docker: LocalDocker | undefined;
  /** This server's deploy/compose.yml (absolute), the only one its containers may come from; null in production. */
  readonly composeFile: string | null;
  readonly hub: RunnerHub;
  /** The machines' maintenance lock, shared with the installs and the runner updates. */
  readonly jobs: MachineJobs;
  readonly logger?: Logger | undefined;
}

/** A Start or Stop done (`already` when the container was there already and nothing ran), or why not. */
export type ContainerActed =
  | { readonly ok: true; readonly status: PowerStatus; readonly already: boolean }
  | ByHand
  | Refusal<409>
  | PowerFailure;

/** Docker did not answer, or its command failed: a 502 with its last line. */
function dockerFailed(action: 'start' | 'stop', why: string | undefined): PowerFailure {
  const detail = (why ?? 'no reason given').slice(0, 500);
  return {
    ok: false,
    status: 502,
    code: 'power_failed',
    message: `Docker did not ${action} the container: ${detail}`,
    driverCode: 'failed',
    detail,
  };
}

/** The machine's container, as for its rebuild: by its runner's id, else in its compose project. */
const lookup = (deps: ContainerPowerDeps, docker: LocalDocker, machine: Machine) =>
  findContainer(
    { docker, composeFile: deps.composeFile },
    machine,
    deps.hub.connected(machine.id)?.caps.containerId,
  );

/** Finds the container and runs the command, while the caller holds the lock. */
async function carryOut(
  deps: ContainerPowerDeps,
  docker: LocalDocker,
  machine: Machine,
  action: 'start' | 'stop',
): Promise<ContainerActed> {
  const found = await lookup(deps, docker, machine);
  if ('error' in found) return dockerFailed(action, found.error);
  if ('missing' in found) {
    return containerMissing(action, machine, containerCommands(machine, deps.composeFile));
  }
  const { container } = found;
  const before = containerStatus(container);
  if (action === 'start' ? UP.includes(before) : before === 'stopped') {
    return { ok: true, status: before, already: true };
  }
  const { args, timeoutMs } = powerCommand(container, action);
  const fields = { machineId: machine.id, container: container.id, action };
  deps.logger?.info(fields, `container power: docker ${action}`);
  const result = await docker.run(args, { timeoutMs });
  if (!result.ok) {
    deps.logger?.warn({ ...fields, error: result.error }, `container power: docker ${action} failed`);
    return dockerFailed(action, result.error);
  }
  return { ok: true, status: action === 'start' ? 'starting' : 'stopped', already: false };
}

/**
 * The container's power as the card shows it: `starting` / `stopping` while this server starts or stops it, else
 * Docker's state; without Docker (or when it does not answer) `running` while its runner is connected, else `unknown`;
 * `missing` when no container of it is found and its runner is not connected.
 */
async function view(deps: ContainerPowerDeps, machine: Machine): Promise<ContainerPowerView> {
  const commands = containerCommands(machine, deps.composeFile);
  const base = { docker: deps.docker !== undefined, commands, error: null };
  const job = deps.jobs.running(machine.id);
  if (job?.kind === 'container_power') {
    return { ...base, status: job.action === 'start' ? 'starting' : 'stopping' };
  }
  const online = deps.hub.isOnline(machine.id);
  const fallback: PowerStatus = online ? 'running' : 'unknown';
  if (deps.docker === undefined) return { ...base, status: fallback };
  const found = await lookup(deps, deps.docker, machine);
  if ('error' in found) return { ...base, status: fallback, error: `Docker did not answer: ${found.error}` };
  if ('missing' in found) return { ...base, status: online ? 'running' : 'missing' };
  return { ...base, status: containerStatus(found.container) };
}

/** Starts or stops the container; a Stop waits for live work unless `force`. One job at a time per machine. */
async function act(
  deps: ContainerPowerDeps,
  machine: Machine,
  action: 'start' | 'stop',
  force: boolean,
): Promise<ContainerActed> {
  const { docker } = deps;
  if (docker === undefined) {
    return powerByHand(action, containerCommands(machine, deps.composeFile), deps.composeFile);
  }
  const taken = deps.jobs.take(machine.id, { kind: 'container_power', action });
  if (!taken.ok) return machineBusy(taken.running);
  try {
    const live =
      action === 'stop' && !force ? liveWork(deps.hub.live(machine.id), 'stop the container') : undefined;
    return live ?? (await carryOut(deps, docker, machine, action));
  } finally {
    taken.lease.release();
  }
}

/** A container's power view, and its Start and Stop; `docker` says whether this server can run them. */
export function containerPower(deps: ContainerPowerDeps) {
  return {
    docker: deps.docker !== undefined,
    view: (machine: Machine) => view(deps, machine),
    act: (machine: Machine, action: 'start' | 'stop', force: boolean) => act(deps, machine, action, force),
  };
}

export type ContainerPower = ReturnType<typeof containerPower>;
