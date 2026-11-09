import { isAbsolute, join } from 'node:path';
import { AiriaDevboxDriver } from './driver.ts';
import { DEFAULT_PATH_DIRS, type ProcessRunOptions, processRun, runEnv } from './run.ts';

/**
 * The airia CLI and gcloud of this computer (docs/machines.md, "The choice"): found on the PATH or in the usual folders
 * without starting a process (the Mac bills each one), and the driver that runs them by their full paths with a short
 * PATH that has their folders. A runner that finds both is a power controller; the server that finds both drives the
 * devboxes itself (MWC_LOCAL_POWER). Whether gcloud is signed in shows on the first command (`needs_gcloud_login`).
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

export interface LocalDevboxDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly exists: (path: string) => boolean;
  /** How the driver runs a command (tests: a fake); `child_process.execFile` by default. */
  readonly execFile?: ProcessRunOptions['execFile'];
}

/** The tools found here and their driver, or which of the two are missing. */
export type LocalDevbox =
  | { readonly ok: true; readonly airia: string; readonly gcloud: string; readonly driver: AiriaDevboxDriver }
  | { readonly ok: false; readonly missing: readonly ('airia' | 'gcloud')[] };

/**
 * The Airia devbox driver of this computer when `airia` and `gcloud` are both found; nothing runs here. Its commands
 * and its tunnels run those two by their full paths, with their folders first on a short PATH and the passed variables.
 */
export function localDevbox(deps: LocalDevboxDeps): LocalDevbox {
  const find = (name: string) =>
    findExecutable(name, { path: deps.env.PATH, home: deps.home, exists: deps.exists });
  const airia = find('airia');
  const gcloud = find('gcloud');
  if (airia === undefined || gcloud === undefined) {
    const missing = [airia === undefined ? 'airia' : [], gcloud === undefined ? 'gcloud' : []].flat();
    return { ok: false, missing: missing as ('airia' | 'gcloud')[] };
  }
  const folder = (path: string) => path.slice(0, path.lastIndexOf('/'));
  const pathDirs = [...new Set([folder(airia), folder(gcloud), ...DEFAULT_PATH_DIRS])];
  const run = processRun({ env: deps.env, pathDirs, ...(deps.execFile ? { execFile: deps.execFile } : {}) });
  // The tunnels run gcloud with the same short PATH and passed variables as the commands.
  const driver = new AiriaDevboxDriver({ run, airia, gcloud, env: runEnv(deps.env, pathDirs) });
  return { ok: true, airia, gcloud, driver };
}
