/**
 * The runner's configuration file (`~/.config/mwc/runner.json`, 0600 in a 0700 folder) and its state folder. The
 * runner reads the file once at start; `mwc runner install` (S4.5) writes it with the same helpers, imported from
 * `@mwc/runner/config`, and `key.rotate` rewrites it with the new key. The file is a loose object, so fields a newer
 * installer adds survive a rewrite by an older runner.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { RUNNER_SLOTS_MAX, RUNNER_WS_PATH, RunnerKey } from '@mwc/shared/runner-protocol';
import { z } from 'zod';

type Env = Readonly<Record<string, string | undefined>>;

/** The longest machine name. */
export const RUNNER_NAME_MAX = 100;

const SERVER_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** True for the server's address as the runner takes it: http(s) or ws(s), without user, query or fragment. */
export function isServerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return SERVER_PROTOCOLS.has(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}

export const RunnerConfig = z.looseObject({
  /** The server's address (`https://<static domain>`, `http://localhost:9950`); the socket is at its `/api/runner/ws`. */
  serverUrl: z.string().refine(isServerUrl, 'an http(s) or ws(s) URL without user, query or fragment'),
  /** The machine this runner is, from enrollment. */
  machineId: z.uuid(),
  /** The runner key (`mwc_rk_…`): it opens the runner socket and nothing else. */
  runnerKey: RunnerKey,
  /** The machine's name, as enrolled. */
  name: z.string().trim().min(1).max(RUNNER_NAME_MAX),
  /** How many runs it takes at once (`runner.hello.caps.slots`). */
  slots: z.int().min(0).max(RUNNER_SLOTS_MAX),
});
export type RunnerConfig = z.infer<typeof RunnerConfig>;

/** A configuration file that cannot be read or written. */
export class RunnerConfigError extends Error {
  override readonly name = 'RunnerConfigError';
}

/** `MWC_RUNNER_CONFIG`, else `runner.json` in `MWC_CONFIG_DIR`, `$XDG_CONFIG_HOME/mwc` or `~/.config/mwc`. */
export function runnerConfigPath(env: Env): string {
  if (env.MWC_RUNNER_CONFIG) return env.MWC_RUNNER_CONFIG;
  if (env.MWC_CONFIG_DIR) return join(env.MWC_CONFIG_DIR, 'runner.json');
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'mwc', 'runner.json');
}

/**
 * The state folder: `MWC_RUNNER_STATE_DIR` (`/var/lib/mwc-runner` in a container), else `$XDG_STATE_HOME/mwc-runner`,
 * else `~/.local/state/mwc-runner`.
 */
export function runnerStateDir(env: Env): string {
  if (env.MWC_RUNNER_STATE_DIR) return env.MWC_RUNNER_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state'), 'mwc-runner');
}

/** The socket's address for a server address: http becomes ws, https wss, and the runner path is appended once. */
export function runnerWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const scheme = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  const base = url.pathname.replace(/\/+$/, '');
  const path = base.endsWith(RUNNER_WS_PATH) ? base : `${base}${RUNNER_WS_PATH}`;
  return `${scheme}//${url.host}${path}`;
}

/** The configuration, checked; a missing, broken or incomplete file is a `RunnerConfigError` that says what to do. */
export function readRunnerConfig(path: string): RunnerConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RunnerConfigError(`${path} does not exist; enroll this machine with mwc runner install`);
    }
    throw new RunnerConfigError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RunnerConfigError(`${path} is not valid JSON`);
  }
  const parsed = RunnerConfig.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`,
    );
    throw new RunnerConfigError(`${path} is not a runner configuration: ${issues.join('; ')}`);
  }
  return parsed.data;
}

/** True when the file is readable or writable by anyone but its owner (it holds the runner key). */
export function isShared(path: string): boolean {
  return (statSync(path).mode & 0o077) !== 0;
}

export interface WriteOptions {
  /** The final step, `rename(tmp, path)`; injectable so a test can fail it. */
  readonly rename?: (from: string, to: string) => void;
}

/**
 * Writes the configuration atomically: checked first, a missing folder made 0700, the JSON written to a new
 * temporary file 0600 beside it, flushed, then renamed over the old file, so a reader sees the old file or the new one.
 * On a failure the temporary file is removed and the old file stays as it was.
 */
export function writeRunnerConfig(path: string, config: RunnerConfig, options: WriteOptions = {}): void {
  const checked = RunnerConfig.parse(config);
  const dir = dirname(path);
  // A new folder is made 0700; an existing one is left as it is (MWC_RUNNER_CONFIG may name a shared folder).
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.runner.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, `${JSON.stringify(checked, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    (options.rename ?? renameSync)(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
