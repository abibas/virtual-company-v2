import type { Machine } from '@mwc/db';
import { isMachinePowerError, type MachinePowerDriver, type PowerReading } from '@mwc/machines-core';
import { AiriaDevboxRef, type PowerAction } from '@mwc/shared/machines';
import type { PowerArgs, TunnelSpec } from '@mwc/shared/runner-protocol';
import type { LocalPower } from '../../../../../platform/processes/power/local.ts';
import { isPowered } from '../../../rules/power.ts';
import { NOT_A_VM } from '../../../rules.ts';
import type { RunnerHub } from '../../runner/hub.ts';
import type { PowerControl } from '../control.ts';
import {
  type Controlled,
  failureOf,
  POWER_TIMEOUTS,
  powerable,
  powerFailed,
  readingOf,
} from '../controller.ts';
import { companyTunnels, reportedTunnel } from '../tunnels.ts';

/**
 * This server's own control (MWC_LOCAL_POWER): it drives every devbox of every company it serves with the airia CLI and
 * gcloud of the computer it runs on (`LocalPower`). A command runs in-process through the driver, with the timeouts a
 * runner controller has and its answer read the same way (`<code>: <message>` → `power_failed` with the driver's code);
 * the boxes' tunnels are held here, one supervisor for every company, their states kept in the hub's memory as this
 * server's. A runner that could power a box gets an empty `tunnel.set` and never a `power.command`. A box's runner too
 * old to update itself is reinstalled from here over SSH (`reinstall`).
 */

/** Who the hub's memory says reported the tunnels this server holds itself. */
export const SERVER_REPORTER = 'server';

/** The longest error a runner controller sends (the protocol's limit): both paths read the same text. */
const ERROR_MAX = 2000;

function call(driver: MachinePowerDriver, machine: Machine, action: PowerAction, args?: PowerArgs) {
  const ref = AiriaDevboxRef.parse(machine.providerRef);
  switch (action) {
    case 'start':
      return driver.start(ref);
    case 'stop':
      return driver.stop(ref);
    case 'status':
      return driver.status(ref);
    case 'set_timezone':
      return driver.setTimezone(ref, args?.timezone ?? '');
  }
}

/** What a runner controller would have answered for this error, read back the same way. */
function failureOfError(error: unknown) {
  if (isMachinePowerError(error)) return failureOf(`${error.code}: ${error.message}`.slice(0, ERROR_MAX));
  const message = error instanceof Error && error.message ? error.message : 'the power command failed';
  return failureOf(message.slice(0, ERROR_MAX));
}

class CommandTimeout extends Error {}

/** `work`, or a `CommandTimeout` after `ms`. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CommandTimeout(`No answer from the airia CLI within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** One command through the driver: the reading as a runner's `power.result` would carry it, or the 502 of its error. */
async function runLocal(
  driver: MachinePowerDriver,
  machine: Machine,
  action: PowerAction,
  args: PowerArgs | undefined,
  timeoutMs: number,
): Promise<Controlled> {
  let reading: PowerReading;
  try {
    reading = await within(call(driver, machine, action, args), timeoutMs);
  } catch (error) {
    if (error instanceof CommandTimeout) return powerFailed({ code: 'timeout', message: error.message });
    return powerFailed(failureOfError(error));
  }
  const metadata = {
    size: reading.size ?? null,
    hourlyCost: reading.hourlyCost ?? null,
    rules: reading.rules,
  };
  const already = reading.already === true;
  return { ok: true, reading: readingOf({ ok: true, status: reading.status, metadata }), already };
}

export interface ServerControlDeps {
  readonly hub: RunnerHub;
  /** The server's own port: both ends of every tunnel. */
  readonly port: number;
  readonly local: LocalPower;
  /** How long each action has (`POWER_TIMEOUTS`); tests shorten them. */
  readonly timeoutsMs?: Partial<Record<PowerAction, number>>;
}

export function serverControl(deps: ServerControlDeps): PowerControl {
  const { hub, port, local } = deps;
  /** The tunnels held, by company; the supervisor holds all of them. */
  const sets = new Map<string, readonly TunnelSpec[]>();
  const companyOf = (machineId: string) =>
    [...sets].find(([, set]) => set.some((tunnel) => tunnel.machineId === machineId))?.[0];
  const holder = local.tunnels((state) => {
    const companyId = companyOf(state.machineId);
    if (companyId !== undefined) hub.tunnels.note(companyId, state, SERVER_REPORTER);
  });
  const timeoutOf = (action: PowerAction) => deps.timeoutsMs?.[action] ?? POWER_TIMEOUTS[action];
  return {
    kind: 'server',
    async resolve(_t, machine) {
      if (!powerable(machine)) return NOT_A_VM;
      return {
        ok: true,
        machineId: null,
        run: (action, args) => runLocal(local.driver, machine, action, args, timeoutOf(action)),
      };
    },
    async syncTunnels(t, machineId) {
      sets.set(t.companyId, await companyTunnels(t, port));
      holder.set([...sets.values()].flat());
      // Never both: a runner that could hold a box's tunnel holds none while this server drives.
      if (machineId !== null && hub.connected(machineId)?.caps.power.includes('airia_devbox')) {
        hub.tunnels.set(machineId, []);
      }
    },
    describe: async (_t, machine) =>
      isPowered(machine) ? { kind: 'server', machineId: null, name: local.name, online: true } : null,
    tunnelOf: (row) => (isPowered(row) ? reportedTunnel(hub, row, SERVER_REPORTER) : null),
    close: () => holder.close(),
    reinstall: (machine, ports) => local.reinstallRunner(AiriaDevboxRef.parse(machine.providerRef), ports),
  };
}
