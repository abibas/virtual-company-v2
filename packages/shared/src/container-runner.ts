import { z } from 'zod';
import { MACHINE_NAME } from './machines.ts';

/**
 * A runner in a Docker container (docs/machines.md, "Installing a runner"): the CPUs, memory and runs at once chosen
 * when it is added, and the compose command that enrolls and starts it. Each container is its own compose project
 * (`mwc-runner-<slug>`), so a second one gets its own container and state volume instead of replacing the first. Pure:
 * the web's add sheet and `mwc machine enroll-token` print the same command.
 */

/** The compose file in the repository, as the command names it when the server does not know its absolute path. */
export const COMPOSE_FILE_RELATIVE = 'deploy/compose.yml';

/** The server address the compose service has unless told another (the dev API on This Mac). */
export const COMPOSE_SERVER_URL = 'http://host.docker.internal:9950';

/** The ranges and defaults of the add sheet's form; compose's own defaults are the same (deploy/compose.yml). */
export const CONTAINER_RUNNER = {
  name: 'Docker runner',
  cpus: { min: 0.5, max: 16, default: 2 },
  memoryGb: { min: 1, max: 64, default: 4 },
  slots: { min: 1, max: 8, default: 2 },
} as const;

/** What the person chooses for a container runner. */
export const ContainerRunnerSettings = z.object({
  name: z.string().trim().min(MACHINE_NAME.min).max(MACHINE_NAME.max),
  /** Docker's `--cpus`: halves and tenths are fine. */
  cpus: z.number().min(CONTAINER_RUNNER.cpus.min).max(CONTAINER_RUNNER.cpus.max),
  memoryGb: z.int().min(CONTAINER_RUNNER.memoryGb.min).max(CONTAINER_RUNNER.memoryGb.max),
  slots: z.int().min(CONTAINER_RUNNER.slots.min).max(CONTAINER_RUNNER.slots.max),
});
export type ContainerRunnerSettings = z.infer<typeof ContainerRunnerSettings>;

/** The defaults: "Docker runner", 2 CPUs, 4 GB, 2 runs at once. */
export const DEFAULT_CONTAINER_RUNNER: ContainerRunnerSettings = {
  name: CONTAINER_RUNNER.name,
  cpus: CONTAINER_RUNNER.cpus.default,
  memoryGb: CONTAINER_RUNNER.memoryGb.default,
  slots: CONTAINER_RUNNER.slots.default,
};

/** The longest slug: compose project names stay short. */
const SLUG_MAX = 40;

/** The compose project's part from a name: lowercase a-z, 0-9 and single dashes (`Docker runner` → `docker-runner`). */
export function containerRunnerSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
  return slug || 'runner';
}

/** The compose project of a container runner (`mwc-runner-docker-runner`). */
export const containerRunnerProject = (name: string): string => `mwc-runner-${containerRunnerSlug(name)}`;

/** A value as one shell word in single quotes (`it's` → `'it'\''s'`). */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/** A path or address as a shell word: as it is when it has nothing the shell reads, else quoted. */
export const shellWord = (value: string): string =>
  /^[\w./:@%+,=-]+$/.test(value) ? value : shellQuote(value);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** True for an address only this machine reaches (localhost, 127.x, ::1). */
export function isLoopback(url: string): boolean {
  const { hostname } = new URL(url);
  return LOOPBACK.has(hostname) || hostname.startsWith('127.');
}

/** The address a container on this machine reaches the server at: a loopback host becomes host.docker.internal. */
export function containerServerUrl(server: string): string {
  if (!isLoopback(server)) return server;
  const url = new URL(server);
  url.hostname = 'host.docker.internal';
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export interface ContainerRunnerCommand extends ContainerRunnerSettings {
  readonly token: string;
  /** The absolute path of deploy/compose.yml (`/api/config`'s `composeFile`); null for the relative one. */
  readonly composeFile: string | null;
  /** The server's address as This Mac reaches it; told to the container only when compose's default does not reach it. */
  readonly server?: string | undefined;
}

/** The command that enrolls and starts one container runner in its own compose project, with its limits. */
export function containerRunnerCommand(c: ContainerRunnerCommand): string {
  const url = c.server === undefined ? COMPOSE_SERVER_URL : containerServerUrl(c.server);
  const env = [
    ...(url === COMPOSE_SERVER_URL ? [] : [`MWC_SERVER_URL=${shellWord(url)}`]),
    `MWC_ENROLL_TOKEN=${c.token}`,
    `MWC_RUNNER_NAME=${shellQuote(c.name.trim())}`,
    `MWC_RUNNER_CPUS=${c.cpus}`,
    `MWC_RUNNER_MEMORY=${c.memoryGb}g`,
    `MWC_RUNNER_SLOTS=${c.slots}`,
  ];
  const file = shellWord(c.composeFile ?? COMPOSE_FILE_RELATIVE);
  return `${env.join(' ')} docker compose -p ${containerRunnerProject(c.name)} -f ${file} --profile runner up -d runner-local`;
}
