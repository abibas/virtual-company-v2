import type { MachineKind, MachineProvider } from '@mwc/shared/enums';
import type { MachinePowerPolicy, PowerStatus } from '@mwc/shared/machines';

/**
 * Waking a machine for work (docs/machines.md, "Waking a machine for work"; pure): which policy switch a trigger asks,
 * whether a start may be sent, whether one is under way, and the words of what cannot be done.
 */

/** What wants the machine: a person's message to an agent on it, or work (a task's step, a Lead's wake-up). */
export type WakeTrigger = 'message' | 'work';

/** The machine as a wake names it. */
export interface WakeMachine {
  readonly id: string;
  readonly name: string;
  readonly kind: MachineKind;
  readonly provider: MachineProvider;
  /** Its price an hour while it runs, when known (a devbox). */
  readonly hourlyCost: number | null;
}

/** How long a box's reading of `starting` or `running` counts as a start under way, its runner on its way. */
export const BOX_UP_FRESH_MS = 5 * 60_000;

/** The policy's switch for the trigger: `autoStartOnMessage` or `autoStartOnWork`. */
export const switchOn = (policy: MachinePowerPolicy, trigger: WakeTrigger): boolean =>
  trigger === 'message' ? policy.autoStartOnMessage : policy.autoStartOnWork;

/** A start may be sent: the switch is on, or a person who may power the machine asked for it. */
export const mayStart = (on: boolean, asked: boolean, canStart: boolean): boolean =>
  on || (asked && canStart);

/** The box was read `starting` or `running` within `BOX_UP_FRESH_MS`: its runner is on its way, nothing is sent. */
export function boxComingUp(
  box: { readonly status: PowerStatus; readonly checkedAt: string | null } | null,
  now: Date,
): boolean {
  if (box === null || box.checkedAt === null || !['starting', 'running'].includes(box.status)) return false;
  return now.getTime() - Date.parse(box.checkedAt) < BOX_UP_FRESH_MS;
}

/** A machine nothing here can start: a laptop wakes by itself, any other runner is started where it runs. */
export function noPowerText(machine: Pick<WakeMachine, 'name' | 'kind'>): string {
  return machine.kind === 'laptop'
    ? `${machine.name} is asleep: wake it, and its runner reconnects on its own`
    : `${machine.name} is offline: start its runner there`;
}

/** A devbox whose controller cannot run the start now (none, or not connected). */
export const noControllerText = (name: string, why: string): string =>
  `${name} is stopped and cannot be started now: ${why}`;

/** A container runner this server has no Docker for. */
export const startByHandText = (name: string): string =>
  `${name} is stopped: run its start command, on the Machines page`;

/** A start that was sent and did not work. */
export const notStartedText = (name: string, why: string): string => `${name} did not start: ${why}`;
