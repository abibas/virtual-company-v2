import type { Machine } from '@mwc/db';
import { containerRunnerProject } from '@mwc/shared/container-runner';
import type { Logger } from 'pino';
import type { LocalDocker } from '../../../../platform/processes/docker/local.ts';
import {
  idsOf,
  inspectArgs,
  projectArgs,
  type RunnerContainer,
  rebuildCommand,
  runnerContainerOf,
} from '../../rules/container.ts';
import {
  type ManualUpdate,
  type UnsupportedUpdate,
  updateFailed,
  updateUnsupported,
} from '../../rules/runner.ts';
import { MACHINE_OFFLINE, type Refusal } from '../../rules.ts';
import type { JobLease } from '../jobs.ts';

/**
 * A container runner's update by this server (`docker_rebuild`, docs/machines.md "Updating a runner"), when it has the
 * Docker CLI of the computer running the containers (MWC_LOCAL_DOCKER): it finds the machine's container (by the id its
 * runner says, `caps.containerId`, else by its compose project, `mwc-runner-<slug of its name>`), reads back its
 * project, compose files, limits and settings, answers at once and rebuilds it in the background with `docker compose …
 * up -d --build runner-local`: its image is built with the runner of this checkout and the container recreated, keeping
 * its volumes (its enrollment, /work and the CLIs it installed). The job shows the build's last line; once compose is
 * done the lock waits for the runner to reconnect, and a failed rebuild is remembered with its last line and the command.
 */

/** How long a rebuild may take: a cold build installs the packages and both CLIs. */
export const REBUILD_TIMEOUT_MS = 15 * 60_000;

/** How long finding the container may take (`docker inspect`, `docker ps`). */
export const LOOKUP_TIMEOUT_MS = 30_000;

export interface RebuildDeps {
  readonly docker: LocalDocker;
  /** This server's deploy/compose.yml (absolute), the only compose file it rebuilds from; null to take the labels'. */
  readonly composeFile: string | null;
  readonly logger?: Logger | undefined;
  /** How long a rebuild may take; `REBUILD_TIMEOUT_MS` unless a test shortens it. */
  readonly rebuildTimeoutMs?: number | undefined;
}

/** The rebuild started (it goes on: `ended` resolves when it ended, never rejecting), or why not. */
export type RebuildStart =
  | { readonly ok: true; readonly ended: Promise<void> }
  | Refusal<409>
  | UnsupportedUpdate
  | Refusal<502>;

type Lookup =
  | { readonly container: RunnerContainer }
  | { readonly missing: true }
  | { readonly error: string };

/** The container runner of this id, if it is one. */
async function inspect(deps: RebuildDeps, id: string): Promise<RunnerContainer | undefined> {
  const read = await deps.docker.run(inspectArgs(id), { timeoutMs: LOOKUP_TIMEOUT_MS });
  return read.ok ? runnerContainerOf(read.stdout, deps.composeFile) : undefined;
}

/** The machine's container: by its runner's id first, else by its compose project; or why Docker could not tell. */
export async function findContainer(
  deps: RebuildDeps,
  machine: Pick<Machine, 'name'>,
  containerId: string | undefined,
): Promise<Lookup> {
  if (containerId !== undefined) {
    const container = await inspect(deps, containerId);
    if (container !== undefined) return { container };
  }
  const listed = await deps.docker.run(projectArgs(containerRunnerProject(machine.name)), {
    timeoutMs: LOOKUP_TIMEOUT_MS,
  });
  if (!listed.ok) return { error: listed.error ?? 'docker ps failed' };
  for (const id of idsOf(listed.stdout)) {
    const container = await inspect(deps, id);
    if (container !== undefined) return { container };
  }
  return { missing: true };
}

/** The rebuild, to its end: then the lock waits for the restart (`done` audits it first), or remembers the failure. */
async function rebuild(
  deps: RebuildDeps,
  container: RunnerContainer,
  lease: JobLease,
  done: () => Promise<void>,
  manual: ManualUpdate,
): Promise<void> {
  const { args, env } = rebuildCommand(container);
  const timeoutMs = deps.rebuildTimeoutMs ?? REBUILD_TIMEOUT_MS;
  const fields = { container: container.id, project: container.project };
  deps.logger?.info(fields, 'runner update: rebuilding the container');
  const result = await deps.docker.run(args, { env, timeoutMs, onLine: (line) => lease.progress(line) });
  if (!result.ok) {
    const why = result.error ?? 'no reason given';
    deps.logger?.warn({ ...fields, error: why }, 'runner update: the container was not rebuilt');
    lease.fail(`The container was not rebuilt: ${why.slice(0, 500)}`, manual.command);
    return;
  }
  deps.logger?.info(fields, 'runner update: the container was rebuilt; waiting for its runner');
  try {
    await done();
  } catch (error) {
    deps.logger?.error({ ...fields, err: error }, 'runner update: could not audit the rebuild');
  }
  lease.restarting();
}

/**
 * Starts rebuilding the machine's container: refused with the command to run when no container of it is found (offline
 * and none found: `machine_offline`), 502 when Docker does not answer; otherwise the rebuild goes on with `lease`.
 */
export async function startRebuild(
  deps: RebuildDeps,
  machine: Pick<Machine, 'name'>,
  runner: { readonly caps: { readonly containerId?: string | undefined } } | undefined,
  lease: JobLease,
  done: () => Promise<void>,
  manual: ManualUpdate,
): Promise<RebuildStart> {
  const found = await findContainer(deps, machine, runner?.caps.containerId);
  if ('error' in found) return updateFailed(`Docker did not answer: ${found.error}`);
  if ('missing' in found) return runner === undefined ? MACHINE_OFFLINE : updateUnsupported(manual);
  const ended = rebuild(deps, found.container, lease, done, manual).catch((error: unknown) => {
    deps.logger?.error({ err: error }, 'runner update: the rebuild stopped');
    lease.fail('The container was not rebuilt: the rebuild stopped unexpectedly', manual.command);
  });
  return { ok: true, ended };
}
