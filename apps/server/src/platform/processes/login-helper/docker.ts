import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Logger } from 'pino';
import { type LoginHelper, LoginHelperError } from './port.ts';
import { type CommandOptions, childSandbox, runCommand, type Spawn } from './process.ts';
import { ttyArgv } from './tty.ts';

/**
 * The development sign-in helper (MWC_LOGIN_HELPER=docker): each login in a throwaway container of the image built
 * from `deploy/Dockerfile.login` (the official CLIs at pinned versions). macOS keeps Claude's login in the Keychain,
 * so the login cannot run on the Mac itself, and it must never touch the Mac's own Claude or Codex login.
 *
 * The container is started detached with `sleep` as its only process, so it outlives the CLI long enough for the
 * login's files to be read (`docker exec … cat`); the login runs in it with `docker exec -i` behind `script`'s
 * pseudo-terminal; `kill` removes the container (`docker rm --force`), which `--rm` also does when `sleep` ends on its
 * own after SANDBOX_LIFETIME_S. A graceful shutdown kills the sandboxes of the sign-ins in progress; every container
 * carries SANDBOX_LABEL and its server's instance label, so `sweep` (at the next start) removes the ones a crashed or
 * killed server left, and only those. Nothing from the host is mounted or passed in: no volume, no environment
 * variable, no credential; no capabilities, no new privileges, a read-only root, a tmpfs home, a memory, CPU and
 * process limit, and the image's non-root `node` user.
 */

/** The image's repository; its tag is the first 12 hex digits of the Dockerfile's SHA-256. */
export const LOGIN_IMAGE_REPOSITORY = 'mwc-login';

/** The sandbox's home: the `node` user's (uid and gid 1000), a tmpfs that dies with the container. */
export const SANDBOX_HOME = '/home/node';

/** The container ends itself after this many seconds: longer than a sign-in's 10 minutes. */
export const SANDBOX_LIFETIME_S = 720;

/** `deploy/Dockerfile.login`, from this file in apps/server/src/platform/processes/login-helper/. */
export const LOGIN_DOCKERFILE = new URL('../../../../../../deploy/Dockerfile.login', import.meta.url);

/** The sign-in image's Dockerfile, as text. */
export const readLoginDockerfile = (): Promise<string> => readFile(LOGIN_DOCKERFILE, 'utf8');

/** How long a short command in a sandbox (`gh api user`) may take. */
export const SANDBOX_RUN_TIMEOUT_MS = 30_000;

/** The label every sandbox carries, so the sweep finds sign-in sandboxes and never another container. */
export const SANDBOX_LABEL = 'mwc.login-helper=1';

/** The label naming the server instance that started a sandbox (`DockerHelperDeps.instance`). */
export const INSTANCE_LABEL = 'mwc.instance';

const NO_DOCKER = 'Docker is not available on this server. Start Docker and try again.';

/** The image's tag for this Dockerfile: a changed file builds a new image. */
export function loginImageTag(dockerfile: string): string {
  const hash = createHash('sha256').update(dockerfile).digest('hex');
  return `${LOGIN_IMAGE_REPOSITORY}:${hash.slice(0, 12)}`;
}

/** `docker run` for one sandbox: detached, removed when it stops, labelled, locked down, nothing from the host. */
export function sandboxRunArgs(image: string, name: string, instance: string): string[] {
  return [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    SANDBOX_LABEL,
    '--label',
    `${INSTANCE_LABEL}=${instance}`,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=64m',
    '--tmpfs',
    `${SANDBOX_HOME}:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--memory',
    '1g',
    '--cpus',
    '1',
    '--user',
    '1000:1000',
    image,
    'sleep',
    String(SANDBOX_LIFETIME_S),
  ];
}

/** `docker exec` of the login in the sandbox, its input a pipe, behind `script`'s pseudo-terminal unless not `tty`. */
export function sandboxExecArgs(name: string, argv: readonly string[], tty = true): string[] {
  return ['exec', '--interactive', name, ...(tty ? ttyArgv(argv) : argv)];
}

/** `docker exec` of a short command in the sandbox, with no terminal and no input. */
export function sandboxCommandArgs(name: string, argv: readonly string[]): string[] {
  return ['exec', name, ...argv];
}

/** `docker exec` that prints one file of the sandbox's home (a path `homePath` checked). */
export function sandboxReadArgs(name: string, path: string): string[] {
  return ['exec', name, 'cat', '--', `${SANDBOX_HOME}/${path}`];
}

/** `docker rm --force`: stops the sandboxes (by name or id) and deletes them with their homes. */
export function sandboxRemoveArgs(...names: string[]): string[] {
  return ['rm', '--force', ...names];
}

/** `docker ps` of the running containers carrying both labels: this instance's sandboxes, by full id. */
export function sweepListArgs(instance: string): string[] {
  const labels = [SANDBOX_LABEL, `${INSTANCE_LABEL}=${instance}`];
  return ['ps', '--quiet', '--no-trunc', ...labels.flatMap((label) => ['--filter', `label=${label}`])];
}

/** The container ids `docker ps --quiet` printed; anything that is not an id is dropped. */
export function containerIds(stdout: string): string[] {
  return stdout.split(/\s+/).filter((id) => /^[0-9a-f]{12,64}$/.test(id));
}

export interface DockerHelperDeps {
  /** `spawn` of `node:child_process`; tests pass a fake. */
  readonly spawn: Spawn;
  /** The Dockerfile's text (`LOGIN_DOCKERFILE`). */
  readonly dockerfile: () => Promise<string>;
  readonly logger: Logger;
  /** This server's instance label (`[\w.-]+`, stable across its restarts): the sweep removes only its sandboxes. */
  readonly instance: string;
  /** A new container name; random by default. */
  readonly newName?: () => string;
}

type Docker = (
  args: readonly string[],
  options: Omit<CommandOptions, 'notFound'>,
) => ReturnType<typeof runCommand>;

/** The image for the current Dockerfile: found, or built from the Dockerfile alone (no build context). */
async function ensureImage(deps: DockerHelperDeps, docker: Docker): Promise<string> {
  const dockerfile = await deps.dockerfile();
  const tag = loginImageTag(dockerfile);
  const found = await docker(['image', 'inspect', '--format', '{{.Id}}', tag], { timeoutMs: 30_000 });
  if (found.error !== undefined) throw new LoginHelperError(found.error);
  if (found.code === 0) return tag;
  deps.logger.info({ image: tag }, 'building the sign-in image');
  const built = await docker(['build', '--tag', tag, '-'], { input: dockerfile, timeoutMs: 15 * 60_000 });
  if (built.code !== 0) {
    deps.logger.error({ image: tag, exitCode: built.code }, 'the sign-in image did not build');
    throw new LoginHelperError('The sign-in image could not be built. Check that Docker is running.');
  }
  deps.logger.info({ image: tag }, 'built the sign-in image');
  return tag;
}

/** Removes this instance's running sandboxes; with Docker stopped or missing, there is nothing to remove. */
async function sweepSandboxes(deps: DockerHelperDeps, docker: Docker): Promise<number> {
  const listed = await docker(sweepListArgs(deps.instance), { timeoutMs: 30_000 });
  if (listed.code !== 0) {
    deps.logger.debug({ exitCode: listed.code }, 'could not list the sign-in sandboxes');
    return 0;
  }
  const ids = containerIds(listed.stdout);
  if (ids.length === 0) return 0;
  const removed = await docker(sandboxRemoveArgs(...ids), { timeoutMs: 60_000 });
  if (removed.code === 0) return ids.length;
  deps.logger.warn({ exitCode: removed.code, count: ids.length }, 'left sign-in sandboxes were not removed');
  return 0;
}

/** The Docker sign-in helper. The image is built on the first sign-in (and again after a failed build). */
export function dockerLoginHelper(deps: DockerHelperDeps): LoginHelper {
  if (!/^[\w.-]+$/.test(deps.instance))
    throw new RangeError('An instance label is letters, digits, _ . and -');
  const docker: Docker = (args, options) =>
    runCommand(deps.spawn, 'docker', args, { ...options, notFound: NO_DOCKER });
  let image: Promise<string> | undefined;
  const imageTag = () => {
    image ??= ensureImage(deps, docker).catch((error: unknown) => {
      image = undefined;
      throw error;
    });
    return image;
  };
  return {
    mode: 'docker',
    async start(command) {
      const tag = await imageTag();
      const name = deps.newName?.() ?? `mwc-login-${randomBytes(6).toString('hex')}`;
      const started = await docker(sandboxRunArgs(tag, name, deps.instance), { timeoutMs: 60_000 });
      if (started.code !== 0) {
        throw new LoginHelperError(
          started.error ?? 'The sign-in sandbox did not start. Check that Docker is running.',
        );
      }
      const child = deps.spawn('docker', sandboxExecArgs(name, command.argv, command.tty), { stdio: 'pipe' });
      return childSandbox(child, {
        readFile: async (path) => {
          const read = await docker(sandboxReadArgs(name, path), { timeoutMs: 15_000 });
          return read.code === 0 ? read.stdout : undefined;
        },
        run: (argv) => docker(sandboxCommandArgs(name, argv), { timeoutMs: SANDBOX_RUN_TIMEOUT_MS }),
        dispose: async () => {
          await docker(sandboxRemoveArgs(name), { timeoutMs: 30_000 });
        },
        notFound: NO_DOCKER,
      });
    },
    sweep: () => sweepSandboxes(deps, docker),
  };
}
