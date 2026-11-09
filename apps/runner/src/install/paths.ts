import { dirname, isAbsolute, join } from 'node:path';
import { type Env, type Host, homeOf } from './host.ts';

/**
 * Where an installed runner lives, and the environment its service runs with. The installed bundle is
 * `~/.local/share/mwc-runner/runner.mjs` on every system; the service file is the launchd agent's plist on macOS and a
 * systemd user unit on Linux.
 */

/** The launchd agent's label on macOS. */
export const LAUNCHD_LABEL = 'com.mwc.runner';
/** The systemd user unit on Linux. */
export const SYSTEMD_UNIT = 'mwc-runner.service';

/** The installed runner's folder: `$XDG_DATA_HOME/mwc-runner`, else `~/.local/share/mwc-runner`. */
export function runnerDataDir(env: Env, home: string): string {
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'mwc-runner');
}

/** The installed bundle, the one the service runs. */
export const installedBundle = (env: Env, home: string): string =>
  join(runnerDataDir(env, home), 'runner.mjs');

/** The launchd agent's plist. */
export const launchdPlistPath = (home: string): string =>
  join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

/** The systemd user unit: `$XDG_CONFIG_HOME/systemd/user`, else `~/.config/systemd/user`. */
export const systemdUnitPath = (env: Env, home: string): string =>
  join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', SYSTEMD_UNIT);

/**
 * The programs the runner and its runs start by name: the service's PATH holds the folders they are in on the
 * installer's PATH, and nothing more (a long PATH multiplies the lookups of every process start).
 */
export const SERVICE_TOOLS = ['claude', 'codex', 'git', 'gh', 'docker', 'airia', 'gcloud'] as const;

/** The system's own folders, always on the service's PATH. */
export const SYSTEM_PATH = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'] as const;

/** The variables an installer's environment passes on to the service when they are set (where its files are). */
export const SERVICE_ENV_KEYS = [
  'MWC_RUNNER_CONFIG',
  'MWC_CONFIG_DIR',
  'MWC_RUNNER_STATE_DIR',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'MWC_RUNNER_HEALTH_PORT',
  'MWC_RUNNER_HOLD',
] as const;

/** The first folder on `pathVar` (absolute ones only) with an executable `name`, or undefined. */
export function findOnPath(
  name: string,
  pathVar: string | undefined,
  isExecutable: (path: string) => boolean,
): string | undefined {
  for (const dir of (pathVar ?? '').split(':')) {
    if (isAbsolute(dir) && isExecutable(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

/** The service's short PATH: Node's folder, the folders of the tools found on the installer's PATH, the system's. */
export function servicePath(host: Host): string {
  const dirs = [dirname(host.execPath)];
  for (const tool of SERVICE_TOOLS) {
    const found = findOnPath(tool, host.env.PATH, host.fs.isExecutable);
    if (found) dirs.push(dirname(found));
  }
  return [...new Set([...dirs, ...SYSTEM_PATH])].join(':');
}

/** One variable of the service's environment. */
export type EnvEntry = readonly [name: string, value: string];

/** The service's environment: its PATH, the variables passed on, and `extra` (the service manager's own). */
export function serviceEnv(host: Host, extra: readonly EnvEntry[] = []): EnvEntry[] {
  const passed = SERVICE_ENV_KEYS.flatMap((key): EnvEntry[] => {
    const value = host.env[key];
    return value ? [[key, value]] : [];
  });
  return [['PATH', servicePath(host)], ...passed, ...extra];
}

/** What a service file says: how to start the runner, with which environment, and where. */
export interface ServiceSpec {
  /** Node, as the installer found it. */
  readonly node: string;
  /** The installed bundle. */
  readonly bundle: string;
  readonly env: readonly EnvEntry[];
  /** The home folder, the service's working folder. */
  readonly home: string;
}

/** The spec of this machine's service, with the service manager's own variables (`extra`). */
export function serviceSpec(host: Host, extra: readonly EnvEntry[] = []): ServiceSpec {
  const home = homeOf(host);
  return { node: host.execPath, bundle: installedBundle(host.env, home), env: serviceEnv(host, extra), home };
}
