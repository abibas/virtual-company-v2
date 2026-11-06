import { ApiError } from '../../api/errors.ts';
import type { Machine, MachinePower, PowerBox, PowerEvent } from '../../api/types.ts';
import { formatTime, formatWeekdayTime } from '../../components/data/format.ts';

/** How a machine's power reads: its hold, the box's own rules, the refusals and the log's actors (pure). */

export const DAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
] as const;

/** The time of a moment: "19:00" today, "Tue, Nov 10, 9:00 AM" on another day. */
function momentText(iso: string, now: number): string {
  const today = new Date(iso).toDateString() === new Date(now).toDateString();
  return today ? formatTime(iso) : formatWeekdayTime(iso);
}

/** Why it is held, in a few words, from the scheduler's reason and the runner's source. */
function holdWhy(reason: string | null, source: Machine['hold']['source']): string | undefined {
  if (source === 'live_runs') return 'agents working';
  if (reason?.includes('keep-on hours')) return 'keep-on hours';
  if (reason?.includes('after the last turn')) return 'after a chat';
  return reason ?? undefined;
}

/** "Kept awake until 19:00 · keep-on hours"; undefined when nothing holds it. */
export function holdText(machine: Machine, power: MachinePower | undefined, now: number): string | undefined {
  const until = machine.hold.until ?? power?.state.holdUntil ?? null;
  if (until === null || Date.parse(until) <= now) return undefined;
  const why = holdWhy(power?.state.holdReason ?? null, machine.hold.source);
  return `Kept awake until ${momentText(until, now)}${why ? ` · ${why}` : ''}`;
}

/**
 * The box's own stop rules in one sentence: "It stops itself after 45 min idle in work hours (8–19), 20 min
 * otherwise, and every night from 20:00 — America/Chicago time".
 */
export function boxRulesText(rules: NonNullable<PowerBox['rules']>): string {
  const night = String(rules.nightlyStopHour).padStart(2, '0');
  return (
    `It stops itself after ${rules.idleShutdownMin} min idle in work hours (${rules.workStartHour}–${rules.workEndHour}), ` +
    `${rules.idleOffhoursMin} min otherwise, and every night from ${night}:00 — ${rules.timezone} time`
  );
}

/** A Start, Stop or time zone refusal in plain words; the driver's own message for a failed command. */
export function powerRefusal(error: unknown, controller: MachinePower['controller']): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.code === 'no_controller')
    return 'No connected machine can start or stop the box. Install the runner on a Mac signed in to gcloud with the airia CLI.';
  if (error.code === 'controller_offline')
    return `Its controller${controller ? `, ${controller.name},` : ''} is not connected. Wake it, then try again.`;
  if (error.code === 'not_a_vm') return 'Only an Airia devbox is started and stopped from here.';
  return error.message;
}

const ACTORS: Readonly<Record<string, string>> = {
  schedule: 'Schedule',
  auto: 'Automatic',
  system: 'System',
};

/** Who did it: the person's name, the scheduler, the system. */
export const actorText = (event: PowerEvent) =>
  event.actorName ?? ACTORS[event.actor] ?? (event.actor.startsWith('user:') ? 'Someone' : event.actor);

/** Every time zone the browser knows, with the ones in use first when it does not list them (UTC). */
export function timeZones(...inUse: readonly string[]): readonly string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return [...inUse.filter((zone) => !known.includes(zone)), ...known];
}
