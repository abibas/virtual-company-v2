import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { type Config, ConfigError } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { type DockerResult, type DockerSpawn, type RunDeps, runDocker } from './run.ts';

/**
 * This computer's Docker CLI for the server (MWC_LOCAL_DOCKER, docs/machines.md "Updating a runner"): when the API runs
 * on the computer that runs the container runners (Ihor's Mac in development), it rebuilds a container runner's image
 * and recreates it itself when someone clicks Update container, instead of showing the command. `docker` is found
 * without starting a process (the Mac bills each one); nothing runs until the machines module asks. Each command gets
 * a short environment: the variables Docker itself reads, never the server's own settings or secrets.
 */

/** The folders searched after the PATH: Docker Desktop's links, Homebrew's, and Docker Desktop's own bin folder. */
export const DOCKER_DIRS: readonly string[] = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/Applications/Docker.app/Contents/Resources/bin',
];

/** The server's environment variables a `docker` command keeps: what Docker, compose and buildx read. */
export const DOCKER_ENV_KEYS: readonly string[] = [
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'XDG_RUNTIME_DIR',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'BUILDX_BUILDER',
];

/** The PATH a command gets after Docker's own folder when the server has none. */
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/** How the machines module runs `docker <args>`: to its end, with extra variables and a time limit. */
export interface LocalDocker {
  /** The `docker` it runs, by its full path. */
  readonly path: string;
  run(
    args: readonly string[],
    options: {
      readonly env?: Readonly<Record<string, string>>;
      readonly timeoutMs: number;
      readonly onLine?: (line: string) => void;
    },
  ): Promise<DockerResult>;
}

/** Where `docker` is looked for and how it runs: this computer's, or fakes. */
export interface DockerHost extends RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists: (path: string) => boolean;
}

const NODE_TIMERS: RunDeps['timers'] = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** This computer: its environment and files, `child_process.spawn` and its process groups. Starts nothing. */
export function nodeDockerHost(env: Readonly<Record<string, string | undefined>> = process.env): DockerHost {
  return {
    env,
    exists: existsSync,
    spawn: spawn as unknown as DockerSpawn,
    killGroup: (pid, signal) => {
      try {
        process.kill(-pid, signal);
      } catch {
        // The group is gone already.
      }
    },
    timers: NODE_TIMERS,
  };
}

/** The full path of `docker`: the PATH's absolute folders first, then `DOCKER_DIRS`; undefined when not found. */
export function findDocker(host: Pick<DockerHost, 'env' | 'exists'>): string | undefined {
  const fromPath = (host.env.PATH ?? '').split(delimiter).filter((dir) => isAbsolute(dir));
  for (const dir of new Set([...fromPath, ...DOCKER_DIRS])) {
    const candidate = join(dir, 'docker');
    if (host.exists(candidate)) return candidate;
  }
  return undefined;
}

/** A command's environment: the kept variables, Docker's folder first on the PATH, then `extra`. */
export function dockerEnv(
  env: Readonly<Record<string, string | undefined>>,
  docker: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const kept = Object.fromEntries(
    DOCKER_ENV_KEYS.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])),
  ) as Record<string, string>;
  const folder = docker.slice(0, docker.lastIndexOf('/'));
  return { ...kept, PATH: `${folder}:${env.PATH || DEFAULT_PATH}`, ...extra };
}

/**
 * The server's own Docker CLI, as MWC_LOCAL_DOCKER says: `auto` when `docker` is found and NODE_ENV is development, `on`
 * when it is found (a `ConfigError` otherwise), `off` never. Logs one line: the docker it uses, or why not.
 */
export function localDockerFromConfig(
  config: Pick<Config, 'MWC_LOCAL_DOCKER' | 'NODE_ENV'>,
  logger: Logger,
  host: DockerHost = nodeDockerHost(),
): LocalDocker | undefined {
  const mode = config.MWC_LOCAL_DOCKER;
  const without = 'container runners are updated with the command the card shows';
  if (mode === 'off' || (mode === 'auto' && config.NODE_ENV !== 'development')) {
    logger.info({ localDocker: mode }, `docker: not used for container runners; ${without}`);
    return undefined;
  }
  const docker = findDocker(host);
  if (docker === undefined) {
    const where = `on the PATH or in ${DOCKER_DIRS.join(', ')}`;
    if (mode === 'on') {
      throw new ConfigError([
        { path: 'MWC_LOCAL_DOCKER', message: `is on, but docker is not found ${where}` },
      ]);
    }
    logger.info({ localDocker: mode }, `docker: not found ${where}; ${without}`);
    return undefined;
  }
  logger.info({ localDocker: mode, docker }, 'docker: this server rebuilds container runners itself');
  return {
    path: docker,
    run: (args, options) =>
      runDocker(host, docker, args, {
        env: dockerEnv(host.env, docker, options.env),
        timeoutMs: options.timeoutMs,
        ...(options.onLine ? { onLine: options.onLine } : {}),
      }),
  };
}
