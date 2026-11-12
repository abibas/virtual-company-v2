import { LEAD_CHECK_IN_CHOICES, LEAD_WAKE } from '@mwc/shared/flows';
import type { LeadWakeSettings, LeadWakes } from '../../../api/flows.ts';
import { ago } from '../../../components/data/format.ts';
import type { SegmentOption } from '../../../components/forms/Segmented.tsx';

/**
 * The "Lead wakes up on" section's words and bounds (S6c), pure: the events' switches, the check-ins' choices, a number
 * kept within its bounds, the settings a PUT sends from the view, and the line saying how the last wake-up went.
 */

/** The events' switches, in order. */
export const WAKE_EVENTS: readonly {
  readonly key: 'escalated' | 'blocked' | 'turnEnded' | 'done';
  readonly label: string;
}[] = [
  { key: 'escalated', label: 'Escalated' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'turnEnded', label: 'Turn ended without a hand-off' },
  { key: 'done', label: 'Done (a digest)' },
];

/** The check-ins' choices: Off and the minutes offered, with a value set elsewhere kept among them. */
export function checkInOptions(current: number | null): SegmentOption<string>[] {
  const minutes = [...new Set([...LEAD_CHECK_IN_CHOICES, ...(current === null ? [] : [current])])];
  return [
    { value: 'off', label: 'Off' },
    ...minutes.sort((a, b) => a - b).map((m) => ({ value: String(m), label: `${m} min` })),
  ];
}

/** The check-ins' setting as a choice, and back. */
export const checkInChoice = (minutes: number | null): string => (minutes === null ? 'off' : String(minutes));
export const checkInMinutes = (choice: string): number | null => (choice === 'off' ? null : Number(choice));

/** A number typed in a box, whole and within `range`. */
export const within = (value: string, range: { readonly min: number; readonly max: number }): number =>
  Math.min(range.max, Math.max(range.min, Math.round(Number(value) || range.min)));

export const BOUNDS = LEAD_WAKE;

/** The settings of a view, as a PUT sends them. */
export const settingsOf = (wakes: LeadWakes): LeadWakeSettings => ({
  escalated: wakes.escalated,
  blocked: wakes.blocked,
  turnEnded: wakes.turnEnded,
  done: wakes.done,
  signoffHours: wakes.signoffHours,
  windowSeconds: wakes.windowSeconds,
  maxPerHour: wakes.maxPerHour,
  maxPerDay: wakes.maxPerDay,
  checkInMinutes: wakes.checkInMinutes,
});

/** How the last wake-up went, and the counts: "Woke it 5 min ago · 2 this hour, 3 today". */
export function lastWords(wakes: LeadWakes): string {
  const counts = `${wakes.counts.hour} this hour, ${wakes.counts.day} today`;
  const waiting = wakes.counts.pending > 0 ? ` · ${wakes.counts.pending} waiting` : '';
  const last = wakes.last;
  if (last === null) return `Not woken yet${waiting}`;
  const when = ago(last.at);
  if (last.outcome === 'woke') return `Woke it ${when} · ${counts}${waiting}`;
  if (last.outcome === 'capped') return `Held ${when}: ${last.detail ?? 'over a cap'} · ${counts}${waiting}`;
  return `Could not wake it ${when}: ${last.detail ?? 'it cannot run'}${waiting}`;
}
