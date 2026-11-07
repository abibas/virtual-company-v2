import { isAbsolute, join } from 'node:path';
import {
  AiriaDevboxDriver,
  DEFAULT_PATH_DIRS,
  type ProcessRunOptions,
  processRun,
  runEnv,
} from '@mwc/machine-airia-devbox';
import { NO_POWER, type PowerExecutor } from '../power.ts';
import { driverExecutor } from './airia-devbox.ts';

/**
 * Whether this machine is a power controller (S4.4b): it is when both the airia CLI and gcloud are installed, found
 * on the PATH or in the usual folders without starting a process (the Mac bills each one). Then its runner announces
 * `caps.power: ['airia_devbox']` and carries out `power.command`s with the Airia devbox driver, which runs those two
 * tools by their full paths with a short PATH that has their folders, and holds each powered box's reverse tunnel with
 * gcloud the same way. Whether gcloud is signed in shows on the first command (`needs_gcloud_login`).
 */

/** The folders searched after the PATH: Homebrew's, the classic one, and gcloud's own install folder. */
export const POWER_TOOL_DIRS: readonly string[] = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '~/google-cloud-sdk/bin',
];

export interface FindDeps {
  /** The PATH (`process.env.PATH`). */
  readonly path: string | undefined;
  /** The home folder, for `~/`. */
  readonly home: string;
  readonly exists: (path: string) => boolean;
}

/** The folders a tool is looked for in, in order: the PATH's absolute ones, then `POWER_TOOL_DIRS`; each once. */
export function searchDirs(deps: Omit<FindDeps, 'exists'>): string[] {
  const fromPath = (deps.path ?? '').split(':').filter((dir) => isAbsolute(dir));
  const usual = POWER_TOOL_DIRS.map((dir) => (dir.startsWith('~/') ? join(deps.home, dir.slice(2)) : dir));
  return [...new Set([...fromPath, ...usual])];
}

/** The full path of the first `name` in `searchDirs`, or undefined. */
export function findExecutable(name: string, deps: FindDeps): string | undefined {
  for (const dir of searchDirs(deps)) {
    const candidate = join(dir, name);
    if (deps.exists(candidate)) return candidate;
  }
  return undefined;
}

export interface DetectDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly exists: (path: string) => boolean;
  /** How the driver runs a command (tests: a fake); `child_process.execFile` by default. */
  readonly execFile?: ProcessRunOptions['execFile'];
}

/** The power executor of this machine: the Airia devbox's when `airia` and `gcloud` are both found, else `NO_POWER`. */
export function detectPowerExecutor(deps: DetectDeps): PowerExecutor {
  const find = (name: string) =>
    findExecutable(name, { path: deps.env.PATH, home: deps.home, exists: deps.exists });
  const airia = find('airia');
  const gcloud = find('gcloud');
  if (airia === undefined || gcloud === undefined) return NO_POWER;
  const folder = (path: string) => path.slice(0, path.lastIndexOf('/'));
  const pathDirs = [...new Set([folder(airia), folder(gcloud), ...DEFAULT_PATH_DIRS])];
  const run = processRun({ env: deps.env, pathDirs, ...(deps.execFile ? { execFile: deps.execFile } : {}) });
  // The tunnels run gcloud with the same short PATH and passed variables as the commands.
  return driverExecutor(new AiriaDevboxDriver({ run, airia, gcloud, env: runEnv(deps.env, pathDirs) }));
}
