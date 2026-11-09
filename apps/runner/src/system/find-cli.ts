import { dirname, isAbsolute, join } from 'node:path';

/**
 * Where a CLI is on this machine (docs/harness.md, "Where the runner finds the CLIs"): the PATH's absolute folders,
 * then the folders installers put CLIs in, without starting a process (the Mac bills each one). A service installed over
 * a non-interactive SSH session has a short PATH (no `~/.local/bin`, where Claude Code's own installer puts `claude`),
 * so the usual folders are searched too. The power tools' search (`localDevbox` of the Airia devbox connector) works
 * the same way with its own folders.
 */

/** The folders searched after the PATH, in order; `~/` is the home folder. The newest nvm Node's `bin` comes last. */
export const CLI_DIRS: readonly string[] = [
  '~/.local/bin',
  '~/.claude/local',
  '~/.npm-global/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
];

/** nvm's installed Node versions (`v24.21.0`, …), each with its own `bin`. */
export const NVM_VERSIONS_DIR = '~/.nvm/versions/node';

/** The files the search reads. */
export interface CliFs {
  /** A file the user may execute. */
  isExecutable(path: string): boolean;
  /** A folder's entries' names; none when it is missing or unreadable. */
  listDir(path: string): readonly string[];
}

export interface FindCliDeps {
  /** The PATH (`process.env.PATH`). */
  readonly path: string | undefined;
  /** The home folder, for `~/`. */
  readonly home: string;
  readonly fs: CliFs;
}

const expand = (dir: string, home: string) => (dir.startsWith('~/') ? join(home, dir.slice(2)) : dir);

/** `v24.21.0` as numbers, or undefined for a name that is not a version. */
function versionOf(name: string): readonly number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return match ? match.slice(1).map(Number) : undefined;
}

/** Whether version `a` is newer than `b`. */
function newer(a: readonly number[], b: readonly number[]): boolean {
  const at = a.findIndex((part, i) => part !== b[i]);
  return at !== -1 && (a[at] as number) > (b[at] as number);
}

/** The `bin` of the newest Node nvm installed (by version, not by name), or undefined. */
export function newestNvmBin(home: string, fs: Pick<CliFs, 'listDir'>): string | undefined {
  const root = expand(NVM_VERSIONS_DIR, home);
  let best: { readonly name: string; readonly version: readonly number[] } | undefined;
  for (const name of fs.listDir(root)) {
    const version = versionOf(name);
    if (version && (best === undefined || newer(version, best.version))) best = { name, version };
  }
  return best && join(root, best.name, 'bin');
}

/** The usual folders, expanded, with the newest nvm `bin` last (when there is one). */
export function usualCliDirs(home: string, fs: Pick<CliFs, 'listDir'>): string[] {
  const nvm = newestNvmBin(home, fs);
  return [...CLI_DIRS.map((dir) => expand(dir, home)), ...(nvm ? [nvm] : [])];
}

/** The folders searched, in order: the PATH's absolute ones, then the usual ones; each once. */
export function cliSearchDirs(deps: FindCliDeps): string[] {
  const fromPath = (deps.path ?? '').split(':').filter((dir) => isAbsolute(dir));
  return [...new Set([...fromPath, ...usualCliDirs(deps.home, deps.fs)])];
}

/** The full path of the first executable `name` in `cliSearchDirs`, or undefined; nothing is started. */
export function findCli(name: string, deps: FindCliDeps): string | undefined {
  for (const dir of cliSearchDirs(deps)) {
    const candidate = join(dir, name);
    if (deps.fs.isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/**
 * `path` with the folder of `command` (a full path) first, once, so a CLI's own helpers resolve (the `node` beside an
 * npm-installed `claude` in an nvm `bin`).
 */
export function pathWithCliDir(command: string, path: string | undefined): string {
  const dir = dirname(command);
  const rest = (path ?? '').split(':').filter((entry) => entry !== '' && entry !== dir);
  return [dir, ...rest].join(':');
}
