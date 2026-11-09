import { isMachinePowerError, type MachinePowerDriver, type PowerReading } from '@mwc/machines-core';
import type { PowerCommand } from '@mwc/shared/runner-protocol';
import type { PowerExecutor, PowerOutcome } from './executor.ts';

/**
 * The power executor of a controller (S4.4b): `power.command`s carried out by a `MachinePowerDriver` (on This Mac,
 * `@mwc/machine-airia-devbox`'s driver with the airia CLI and gcloud). Its answer is the driver's reading (status,
 * and size, hourly cost and the box's own rules as metadata), or the driver's error as `<code>: <message>`, which the
 * server reads back into its code.
 */

/** The longest `power.result.error` (the protocol's limit). */
const ERROR_MAX = 2000;

function run(driver: MachinePowerDriver, command: PowerCommand): Promise<PowerReading> {
  const { ref } = command.target;
  switch (command.action) {
    case 'start':
      return driver.start(ref);
    case 'stop':
      return driver.stop(ref);
    case 'status':
      return driver.status(ref);
    case 'set_timezone':
      // The protocol refuses a `set_timezone` without `args.timezone`.
      return driver.setTimezone(ref, command.args?.timezone as string);
  }
}

/**
 * A reading as a `power.result`'s status and metadata (facts the driver does not know are null; `already` when a start
 * or a stop found the box already there and ran nothing).
 */
export function outcomeOf(reading: PowerReading): PowerOutcome {
  const metadata = {
    size: reading.size ?? null,
    hourlyCost: reading.hourlyCost ?? null,
    rules: reading.rules,
    ...(reading.already ? { already: true } : {}),
  };
  return { ok: true, status: reading.status, metadata };
}

/**
 * The executor of a driver: it announces the driver's provider and refuses commands for any other; its tunnels are the
 * driver's (none for another provider, or a driver without them).
 */
export function driverExecutor(driver: MachinePowerDriver): PowerExecutor {
  return {
    providers: [driver.provider],
    tunnelCommand(tunnel) {
      if (tunnel.target.provider !== driver.provider) return undefined;
      const { remotePort, localPort } = tunnel;
      return driver.tunnelCommand?.(tunnel.target.ref, { remotePort, localPort });
    },
    clearPortCommand(tunnel) {
      if (tunnel.target.provider !== driver.provider) return undefined;
      return driver.clearPortCommand?.(tunnel.target.ref, tunnel.remotePort);
    },
    async execute(command) {
      if (command.target.provider !== driver.provider) {
        return { ok: false, error: `failed: this runner powers ${driver.provider} machines only` };
      }
      try {
        return outcomeOf(await run(driver, command));
      } catch (error) {
        if (!isMachinePowerError(error)) throw error;
        return { ok: false, error: `${error.code}: ${error.message}`.slice(0, ERROR_MAX) };
      }
    },
  };
}
