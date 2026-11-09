import { Cloud, Container, Laptop, type LucideIcon } from 'lucide-react';
import type { MachineKind, MachineStats, PowerBox } from '../../../api/types.ts';
import type { Tone } from '../../../components/ui/Badge.tsx';

/** How a machine and its numbers read on the board and the Machines page (pure). */

/** The load per CPU above which a machine is overloaded (the server's rule), and the CPU share. */
export const LOAD_LIMIT = 1;
export const CPU_LIMIT = 85;

const ICONS: Readonly<Record<MachineKind, LucideIcon>> = { laptop: Laptop, container: Container, vm: Cloud };

export const kindIcon = (kind: MachineKind): LucideIcon => ICONS[kind];

/** What kind of machine it is, in words. */
export function kindName(kind: MachineKind, provider: string): string {
  if (provider === 'airia_devbox') return 'Airia devbox';
  return { laptop: 'Mac', container: 'Docker container', vm: 'Virtual machine' }[kind];
}

/** A span to the hour or minute: "8d 3h", "3h 12m", "4m". */
export function spanText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** How long ago: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

/** The status in words with its tone: "Running · up 8d 3h", "Asleep · last seen 5 min ago", "Offline". */
export function statusText(
  machine: Pick<MachineStats, 'status' | 'kind' | 'lastSeenAt' | 'upSince'>,
  now: number,
): { readonly words: string; readonly tone: Tone } {
  if (machine.status === 'draining') return { words: 'Draining', tone: 'input' };
  if (machine.status === 'online') {
    const up = machine.upSince ? ` · up ${spanText(now - Date.parse(machine.upSince))}` : '';
    return { words: `Running${up}`, tone: 'done' };
  }
  const down = machine.kind === 'laptop' ? 'Asleep' : 'Offline';
  const seen = machine.lastSeenAt ? ` · last seen ${agoText(machine.lastSeenAt, now)}` : ' · never connected';
  return { words: `${down}${seen}`, tone: 'pending' };
}

export const loadText = (value: number) => value.toFixed(2);
export const percentText = (value: number) => `${Math.round(value)}%`;

const GB = 1024 ** 3;

/** Disk in use: "836 / 926 GB". */
export const diskText = (used: number, total: number) =>
  `${Math.round(used / GB)} / ${Math.round(total / GB)} GB`;

/** Hours: "24.0 h" under a hundred, "168 h" from there. */
export function hoursText(ms: number): string {
  const hours = ms / 3_600_000;
  return hours >= 100 ? `${Math.round(hours)} h` : `${hours.toFixed(1)} h`;
}

/** The box's power status in words, with its tone. */
export const BOX_STATUS: Readonly<Record<PowerBox['status'], readonly [string, Tone]>> = {
  running: ['Running', 'done'],
  stopped: ['Stopped', 'pending'],
  starting: ['Starting…', 'input'],
  stopping: ['Stopping…', 'input'],
  missing: ['Not found', 'failed'],
  unknown: ['Unknown', 'pending'],
};

/** An hourly cost: "$0.27/h". */
export const costText = (dollars: number) => `$${dollars.toFixed(2)}/h`;
