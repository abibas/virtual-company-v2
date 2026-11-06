import { diffFields, type Machine, type TenantDb } from '@mwc/db';
import {
  MACHINE_POWER_ERROR_CODES,
  MACHINE_POWER_ERROR_MESSAGES,
  type MachinePowerErrorCode,
} from '@mwc/machines-core';
import { newId } from '@mwc/shared/ids';
import { AiriaDevboxRef, type PowerAction, type PowerStatus } from '@mwc/shared/machines';
import type { PowerArgs, PowerCommand, PowerResult } from '@mwc/shared/runner-protocol';
import { machinesRepo } from '../../repo.ts';
import { isPowered } from '../../rules/power.ts';
import {
  CONTROLLER_OFFLINE,
  NO_CONTROLLER,
  NOT_A_VM,
  type Refusal,
  SEVERAL_CONTROLLERS,
} from '../../rules.ts';
import { HubError, type RunnerHub } from '../hub.ts';
import { type BoxReading, StoredBox } from './store.ts';

/**
 * Powering a devbox through its controller (docs/machines.md, "The choice"): a box cannot start itself, so its
 * `power.command`s go to the runner of `machines.controller_machine_id` (This Mac, with the airia CLI and gcloud). A box
 * with none gets the one connected machine of its company whose runner can power it, saved as its controller.
 */

const repo = machinesRepo();

/** A command the controller ran and failed: a 502 `power_failed` with the driver's code and its own words. */
export interface PowerFailure extends Refusal<502> {
  readonly driverCode: MachinePowerErrorCode;
  /** The driver's message, for the power log (the response carries the plain one). */
  readonly detail: string;
}

export type ControlRefusal = Refusal<409> | Refusal<422> | PowerFailure;

/** How long the controller has for each action: a start re-pushes the box's scripts first. */
export const POWER_TIMEOUTS: Readonly<Record<PowerAction, number>> = {
  start: 200_000,
  stop: 200_000,
  status: 75_000,
  set_timezone: 75_000,
};

const CODES: ReadonlySet<string> = new Set(MACHINE_POWER_ERROR_CODES);
/** The power hook's answer of a runner that drives nothing: the tools are not there. */
const NO_POWER_DRIVER = 'no_power_driver';

/** The driver's code and message in a `power.result`'s error (`<code>: <message>`); `failed` for anything else. */
export function failureOf(error: string | undefined): { code: MachinePowerErrorCode; message: string } {
  if (error === NO_POWER_DRIVER)
    return { code: 'cli_missing', message: MACHINE_POWER_ERROR_MESSAGES.cli_missing };
  const match = /^([a-z_]+): ([\s\S]+)$/.exec(error ?? '');
  if (match !== null && CODES.has(match[1] as string)) {
    return { code: match[1] as MachinePowerErrorCode, message: match[2] as string };
  }
  return { code: 'failed', message: error || MACHINE_POWER_ERROR_MESSAGES.failed };
}

/** The 502 of a failure. */
export function powerFailed(failure: { code: MachinePowerErrorCode; message: string }): PowerFailure {
  return {
    ok: false,
    status: 502,
    code: 'power_failed',
    message: MACHINE_POWER_ERROR_MESSAGES[failure.code],
    driverCode: failure.code,
    detail: failure.message,
  };
}

const ReadingMetadata = StoredBox.pick({ size: true, hourlyCost: true, rules: true });

/** The box as a successful `power.result` reads it; facts it lacks or garbles are null. */
export function readingOf(result: PowerResult): BoxReading {
  const status: PowerStatus = result.status ?? 'unknown';
  return { status, ...ReadingMetadata.parse(result.metadata ?? {}) };
}

/** True when the machine is a devbox with a readable reference. */
const powerable = (machine: Machine) =>
  isPowered(machine) && AiriaDevboxRef.safeParse(machine.providerRef).success;

/** The company's one connected machine (besides this one) whose runner can power a devbox; saved as its controller. */
async function pickController(t: TenantDb, hub: RunnerHub, machine: Machine) {
  const able = (await repo.list(t)).filter(
    (other) => other.id !== machine.id && hub.connected(other.id)?.caps.power.includes('airia_devbox'),
  );
  if (able.length !== 1) return able.length === 0 ? NO_CONTROLLER : SEVERAL_CONTROLLERS;
  const controllerId = (able[0] as Machine).id;
  await repo.update(t, machine.id, { controllerMachineId: controllerId });
  const changes = diffFields(
    { controllerMachineId: machine.controllerMachineId },
    { controllerMachineId: controllerId },
  );
  await repo.audit(t, {
    actorKind: 'system',
    entityType: 'machine',
    entityId: machine.id,
    action: 'update',
    changes,
  });
  return { ok: true as const, controllerId };
}

/**
 * The connected controller of a devbox: its own (`controller_offline` when not connected), else the one machine that
 * can power it (`no_controller` when there is none or more than one). `not_a_vm` for any other machine.
 */
export async function resolveController(
  t: TenantDb,
  hub: RunnerHub,
  machine: Machine,
): Promise<{ readonly ok: true; readonly controllerId: string } | Refusal<409> | Refusal<422>> {
  if (!powerable(machine)) return NOT_A_VM;
  const own =
    machine.controllerMachineId === null ? undefined : await repo.get(t, machine.controllerMachineId);
  if (own === undefined) return pickController(t, hub, machine);
  return hub.isOnline(own.id) ? { ok: true, controllerId: own.id } : CONTROLLER_OFFLINE;
}

/**
 * Sends one `power.command` for the devbox to its controller and waits for the answer: the reading, a 502 when the
 * driver failed or the controller did not answer in time, `controller_offline` when it went away first.
 */
export async function command(
  hub: RunnerHub,
  controllerId: string,
  machine: Machine,
  action: PowerAction,
  options: { readonly args?: PowerArgs; readonly timeoutMs?: number } = {},
): Promise<{ readonly ok: true; readonly reading: BoxReading } | ControlRefusal> {
  const frame: PowerCommand = {
    type: 'power.command',
    cmdId: newId(),
    target: { provider: 'airia_devbox', ref: AiriaDevboxRef.parse(machine.providerRef) },
    action,
    ...(options.args === undefined ? {} : { args: options.args }),
  };
  try {
    const result = await hub.request(controllerId, frame, {
      timeoutMs: options.timeoutMs ?? POWER_TIMEOUTS[action],
    });
    return result.ok ? { ok: true, reading: readingOf(result) } : powerFailed(failureOf(result.error));
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    if (error.code === 'timeout') return powerFailed({ code: 'timeout', message: error.message });
    return CONTROLLER_OFFLINE;
  }
}
