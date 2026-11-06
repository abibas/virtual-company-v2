import type { PowerProvider } from '@mwc/shared/machines';
import type { PowerCommand, PowerResult } from '@mwc/shared/runner-protocol';

/**
 * The power controller hook (`@mwc/runner/power`): what the runner does with a `power.command`. S4.3 ships the
 * executor of a runner that drives nothing; S4.4b passes one built on `@mwc/machines-core`'s driver (the Airia
 * devbox connector), whose `providers` the runner announces in `runner.hello.caps.power`.
 */

/** A `power.result` without its `type` and `cmdId`. */
export type PowerOutcome = Omit<PowerResult, 'type' | 'cmdId'>;

export interface PowerExecutor {
  /** The providers this machine can drive (`caps.power`); empty when it is no controller. */
  readonly providers: readonly PowerProvider[];
  /** Carries out one command; a throw is reported as `ok: false` with its message. */
  execute(command: PowerCommand): Promise<PowerOutcome>;
}

/** The answer of a runner without a power driver. */
export const NO_POWER_DRIVER = 'no_power_driver';

/** A runner that drives no machine: every command fails with `no_power_driver`. */
export const NO_POWER: PowerExecutor = {
  providers: [],
  execute: async () => ({ ok: false, error: NO_POWER_DRIVER }),
};

/** The `power.result` for a command: the executor's outcome, or its error as `ok: false`. */
export async function runPowerCommand(executor: PowerExecutor, command: PowerCommand): Promise<PowerResult> {
  try {
    const outcome = await executor.execute(command);
    return { type: 'power.result', cmdId: command.cmdId, ...outcome };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'the power command failed';
    return { type: 'power.result', cmdId: command.cmdId, ok: false, error: message.slice(0, 2000) };
  }
}
