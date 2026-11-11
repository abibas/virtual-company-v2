import type { MachineChoice, MachinePower } from '../../api/types.ts';
import { costText } from '../machines/card/machine-text.ts';

/**
 * How an offline machine reads where its agent is placed (pure): one line on its state, and what can wake it from here —
 * a Start (a devbox through its controller, a container through this server's Docker), the command to run by hand (a
 * container without this server's Docker), or nothing (a laptop wakes on its own; members and viewers cannot start).
 */

export type WakeAction =
  | { readonly kind: 'start'; readonly label: string; readonly title: string; readonly short: string }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'none'; readonly hint: string | undefined };

export interface WakeView {
  readonly line: string;
  readonly action: WakeAction;
}

type Machine = Pick<MachineChoice, 'name' | 'kind' | 'provider' | 'hourlyCost'>;

const NOT_CONNECTED = (name: string) => `${name} is up, but its runner is not connected.`;
const ADMIN_STARTS = 'An admin or owner can start it.';

/** Start's label and its tooltip, with the hourly cost when one is known. */
function startAction(machine: Machine, cost: number | null): WakeAction {
  const price = cost === null ? '' : ` · ${costText(cost)}`;
  return {
    kind: 'start',
    label: `Start ${machine.name}${price}`,
    short: `Start${price}`,
    title:
      cost === null
        ? `Starts ${machine.name}`
        : `Starts ${machine.name} (about ${costText(cost)} while it runs)`,
  };
}

function devboxView(machine: Machine, power: MachinePower | undefined): WakeView {
  const status = power?.box?.status;
  if (status === 'running')
    return { line: NOT_CONNECTED(machine.name), action: { kind: 'none', hint: undefined } };
  if (status === 'starting')
    return { line: `${machine.name} is starting.`, action: { kind: 'none', hint: undefined } };
  const line = `${machine.name} is stopped.`;
  if (!power) return { line, action: { kind: 'none', hint: undefined } };
  if (!power.canControl) return { line, action: { kind: 'none', hint: ADMIN_STARTS } };
  if (status === 'stopping')
    return { line, action: { kind: 'none', hint: 'It is still stopping. Try in a minute.' } };
  return { line, action: startAction(machine, power.box?.hourlyCost ?? machine.hourlyCost) };
}

function containerView(machine: Machine, power: MachinePower | undefined): WakeView {
  const container = power?.container;
  if (container?.status === 'running')
    return { line: NOT_CONNECTED(machine.name), action: { kind: 'none', hint: undefined } };
  if (container?.status === 'starting')
    return { line: `${machine.name} is starting.`, action: { kind: 'none', hint: undefined } };
  const line = `${machine.name} is stopped.`;
  if (!power || !container) return { line, action: { kind: 'none', hint: undefined } };
  if (!power.canControl) return { line, action: { kind: 'none', hint: ADMIN_STARTS } };
  if (!container.docker) {
    const command = container.status === 'missing' ? container.commands.create : container.commands.start;
    return { line, action: { kind: 'command', command } };
  }
  return { line, action: startAction(machine, null) };
}

/** The offline machine's line and its wake action. */
export function wakeView(machine: Machine, power: MachinePower | undefined): WakeView {
  if (machine.provider === 'airia_devbox') return devboxView(machine, power);
  if (machine.kind === 'container') return containerView(machine, power);
  if (machine.kind === 'laptop')
    return {
      line: `${machine.name} is asleep.`,
      action: { kind: 'none', hint: 'Wake it: its runner reconnects on its own.' },
    };
  return {
    line: `${machine.name} is offline.`,
    action: { kind: 'none', hint: 'Start it there: its runner reconnects on its own.' },
  };
}

/** A machine marked online whose runner did not answer the folder browser. */
export const runnerGoneLine = (name: string) => `${name}'s runner is not connected.`;

/** "0:42", "12:05". */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The Machines page with this machine's card open, for a new tab. */
export const machineCardHref = (machinesHref: string, machineId: string) =>
  `${machinesHref}?machine=${encodeURIComponent(machineId)}`;
