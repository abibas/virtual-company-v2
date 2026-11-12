import type { MachineWait } from '@mwc/shared/enums';
import type { WakeMachine, WakeTrigger } from '../../machines/index.ts';
import { type Refusal, refuse } from '../rules.ts';

/**
 * A turn for an agent whose machine is stopped (docs/harness.md, "When the machine is stopped"; pure): how long a turn
 * waits for the machine to start, the refusals when it is not started (the switch off: `machine_stopped`, with what the
 * web needs to offer Start and send; nothing here can start it: `machine_offline` in the wake's words), the power
 * log's reason for a message, and the words of a wait that ran out. And a turn whose machine has every slot taken
 * ("Waiting for a free slot"): whether a slot is free for a chat's turn, oldest waiting chat first, how long it waits,
 * and its words.
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

/** How long a turn waits for a free slot on its machine before it fails. */
export const SLOT_WAIT_MS = 30 * 60_000;

/** How long a turn waits for what it waits for. */
const WAIT_MS: Readonly<Record<MachineWait, number>> = { stopped: MACHINE_WAIT_MS, slots: SLOT_WAIT_MS };

/** True once a turn has waited its time for its machine (to start, or for a free slot). */
export const waitedOut = (since: Date, now: Date, wait: MachineWait = 'stopped'): boolean =>
  now.getTime() - since.getTime() >= WAIT_MS[wait];

/** A machine's slots as a turn finds them: how many it takes, how many turns run there. */
export interface MachineSlots {
  readonly name: string;
  readonly slots: number;
  readonly live: number;
}

/** "2 of 2 in use". */
const inUse = (slots: MachineSlots) => `${slots.live} of ${slots.slots} in use`;

/** A turn's wait for a free slot ran out. */
export const noSlotText = (slots: MachineSlots): string =>
  `${slots.name} had no free slot for ${SLOT_WAIT_MS / 60_000} minutes (${inUse(slots)})`;

/** A Compact or an answer while every slot is taken: it does not wait, it is refused. */
export const machineBusy = (slots: MachineSlots): Refusal<409> =>
  refuse(
    409,
    'machine_busy',
    `${slots.name} has no free slot (${inUse(slots)}): try again when a turn there ends`,
  );

/** A chat on the machine with turns waiting for a slot, since its oldest began to wait. */
export interface SlotWaiter {
  readonly chatId: string;
  readonly since: Date;
}

/**
 * True when a turn of the chat may take a slot now: the chats waiting for one longer than this chat (all of them when it
 * waits for none) go first, so a slot is free when the live turns and those chats leave one.
 */
export function slotFree(chatId: string, waiters: readonly SlotWaiter[], slots: MachineSlots): boolean {
  const ordered = [...waiters].sort(
    (a, b) => a.since.getTime() - b.since.getTime() || a.chatId.localeCompare(b.chatId),
  );
  const mine = ordered.findIndex((waiter) => waiter.chatId === chatId);
  const ahead = mine < 0 ? ordered.length : mine;
  return slots.live + ahead < slots.slots;
}
