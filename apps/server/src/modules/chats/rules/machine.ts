import type { WakeMachine, WakeTrigger } from '../../machines/index.ts';
import { type Refusal, refuse } from '../rules.ts';

/**
 * A turn for an agent whose machine is stopped (docs/harness.md, "When the machine is stopped"; pure): how long a turn
 * waits for the machine to start, the refusals when it is not started (the switch off: `machine_stopped`, with what the
 * web needs to offer Start and send; nothing here can start it: `machine_offline` in the wake's words), the power
 * log's reason for a message, and the words of a wait that ran out.
 */

/** How long a turn waits for its machine's runner after the start before it fails. */
export const MACHINE_WAIT_MS = 10 * 60_000;

/** The machine as a `machine_stopped` refusal names it: enough for the web's "Start <machine> · $0.54/h and send". */
export interface StoppedMachine {
  readonly id: string;
  readonly name: string;
  readonly hourlyCost: number | null;
  /** The person may start it (an admin or owner): the web offers Start and send. */
  readonly canStart: boolean;
}

/** The switch for the trigger is off and nobody asked to start the machine. */
export interface MachineStopped extends Refusal<409> {
  readonly machine: StoppedMachine;
}

/**
 * The machine is stopped and its switch for the trigger is off: a message is refused with what Start and send needs;
 * work (a step's run, a Lead's wake-up) says to start it and retry.
 */
export function machineStopped(
  machine: WakeMachine,
  canStart: boolean,
  trigger: WakeTrigger,
): MachineStopped {
  const message =
    trigger === 'message'
      ? `${machine.name} is stopped`
      : `${machine.name} is stopped: start it on the Machines page, then retry`;
  const { id, name, hourlyCost } = machine;
  return { ...refuse(409, 'machine_stopped', message), machine: { id, name, hourlyCost, canStart } };
}

/** True for a `machine_stopped` refusal (it carries the machine). */
export const isMachineStopped = (refusal: Refusal): refusal is MachineStopped => 'machine' in refusal;

/** Nothing here can start the machine now: the wake's words (asleep, no controller, a start by hand). */
export const cannotStart = (message: string): Refusal<409> => refuse(409, 'machine_offline', message);

/** A message's reason in the machine's power log. */
export const messageReason = (agentName: string): string => `Started for a message to ${agentName}`;

/** A turn's wait for its machine ran out. */
export const notConnectedText = (machineName: string): string =>
  `${machineName} did not connect within ${MACHINE_WAIT_MS / 60_000} minutes`;

/** True once a turn has waited `MACHINE_WAIT_MS` for its machine. */
export const waitedOut = (since: Date, now: Date): boolean =>
  now.getTime() - since.getTime() >= MACHINE_WAIT_MS;
