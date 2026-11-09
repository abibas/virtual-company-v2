import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { type LocalDevboxDeps, localDevbox, POWER_TOOL_DIRS } from '@mwc/machine-airia-devbox';
import type { MachinePowerDriver } from '@mwc/machines-core';
import { type TunnelDeps, type TunnelKill, type TunnelSpawn, Tunnels } from '@mwc/machines-core/tunnels';
import { type Config, ConfigError } from '@mwc/shared/config';
import type { TunnelSpec, TunnelState } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';

/**
 * The server's own power driver (MWC_LOCAL_POWER, docs/machines.md "The choice"): when the API runs on a computer with
 * the airia CLI and gcloud (Ihor's Mac in development, as him, with his gcloud sign-in), it starts and stops the Airia
 * devboxes with them and holds their reverse tunnels itself, so no runner on that computer is needed. The tools are
 * found the way a runner finds them (no process started to look); the connector is wired here, and the machines module
 * only sees `LocalPower`. Nothing runs until the machines module asks: a command, or a tunnel to hold.
 */

/** How the API names this server as the devboxes' controller. */
export const LOCAL_POWER_NAME = 'This server (airia CLI)';

/** The tunnels this server holds: the full set to hold now (reconciled), and their end at shutdown. */
export interface TunnelHolder {
  set(tunnels: readonly TunnelSpec[]): void;
  close(): Promise<void>;
}

/** This server's power driver, through which the machines module drives every devbox, and its tunnels. */
export interface LocalPower {
  readonly name: string;
  readonly driver: MachinePowerDriver;
  /** Starts holding tunnels (called once): each change of a tunnel's state goes to `report`. */
  tunnels(report: (state: TunnelState) => void): TunnelHolder;
}

/** Where the tools are looked for and how their tunnels start: this computer's, or fakes. */
export interface PowerHost extends LocalDevboxDeps {
  readonly spawn: TunnelSpawn;
  readonly killGroup: TunnelKill;
  readonly clock?: TunnelDeps['clock'];
  readonly timers?: TunnelDeps['timers'];
}

const NODE_CLOCK: TunnelDeps['clock'] = { monotonic: () => performance.now() };
const NODE_TIMERS: TunnelDeps['timers'] = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Signals a whole process group (`kill(-pid, signal)`), quiet once it is gone. */
export function groupKiller(kill: (pid: number, signal: NodeJS.Signals) => unknown): TunnelKill {
  return (pid, signal) => {
    try {
      kill(-pid, signal);
    } catch {
      // The group is gone already.
    }
  };
}

/** This computer: its PATH, home folder and files, `child_process.spawn` and its process groups. Starts nothing. */
export function nodePowerHost(env: Readonly<Record<string, string | undefined>> = process.env): PowerHost {
  return {
    env,
    home: homedir(),
    exists: existsSync,
    spawn,
    killGroup: groupKiller(process.kill.bind(process)),
  };
}

/** The supervisor's lines in the server's log. */
const logOf = (logger: Logger): TunnelDeps['log'] => ({
  info: (msg, fields) => logger.info({ ...fields }, `power: ${msg}`),
  warn: (msg, fields) => logger.warn({ ...fields }, `power: ${msg}`),
});

const RUNNERS = 'runner controllers start and stop the devboxes';

/**
 * The server's own power driver, as MWC_LOCAL_POWER says: `auto` when both tools are found and NODE_ENV is not
 * production, `on` when they are found (a `ConfigError` naming the missing ones otherwise), `off` never. Logs one line:
 * the tools it uses, or why not.
 */
export function localPowerFromConfig(
  config: Pick<Config, 'MWC_LOCAL_POWER' | 'NODE_ENV'>,
  logger: Logger,
  host: PowerHost = nodePowerHost(),
): LocalPower | undefined {
  const mode = config.MWC_LOCAL_POWER;
  if (mode === 'off') {
    logger.info({ localPower: mode }, `power: MWC_LOCAL_POWER is off; ${RUNNERS}`);
    return undefined;
  }
  if (mode === 'auto' && config.NODE_ENV === 'production') {
    logger.info({ localPower: mode }, `power: the airia CLI is not driven in production; ${RUNNERS}`);
    return undefined;
  }
  const found = localDevbox(host);
  if (!found.ok) {
    const where = `on the PATH or in ${POWER_TOOL_DIRS.join(', ')}`;
    const missing = found.missing.join(' and ');
    if (mode === 'on') {
      const message = `is on, but ${missing} ${found.missing.length > 1 ? 'are' : 'is'} not found ${where}`;
      throw new ConfigError([{ path: 'MWC_LOCAL_POWER', message }]);
    }
    logger.info({ localPower: mode, missing: found.missing }, `power: no ${missing} ${where}; ${RUNNERS}`);
    return undefined;
  }
  const { driver, airia, gcloud } = found;
  logger.info(
    { localPower: mode, airia, gcloud },
    'power: this server starts and stops the devboxes with the airia CLI and holds their tunnels with gcloud',
  );
  return {
    name: LOCAL_POWER_NAME,
    driver,
    tunnels: (report) =>
      new Tunnels({
        // Every tunnel this server is given is a devbox's (`airia_devbox`, the driver's provider).
        command: ({ target, remotePort, localPort }) =>
          driver.tunnelCommand(target.ref, { remotePort, localPort }),
        spawn: host.spawn,
        killGroup: host.killGroup,
        clock: host.clock ?? NODE_CLOCK,
        timers: host.timers ?? NODE_TIMERS,
        log: logOf(logger),
        report,
      }),
  };
}
