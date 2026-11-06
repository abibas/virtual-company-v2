import type { KeepOnWindow } from '@mwc/shared/machines';

/**
 * The keep-on window's clock (docs/machines.md, the power policy), pure: wall-clock times in an IANA time zone and the
 * instants they fall on, daylight saving included, and which keep-on window (if any) an instant is in. A window is
 * named by the local date it starts on (`2026-11-06`), so a window overnight (22:00–06:00) is one window across
 * midnight.
 */

const DAY_MS = 24 * 60 * 60_000;

/** A wall-clock time in a time zone; `weekday` is ISO (1 Monday … 7 Sunday). */
export interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: number;
}

/** One keep-on window: its name (the local date it starts on) and the instants it starts and ends. */
export interface KeepOnSpan {
  readonly id: string;
  readonly start: Date;
  readonly end: Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let format = formatters.get(timezone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, format);
  }
  return format;
}

/** The ISO weekday of a calendar date (1 Monday … 7 Sunday). */
export function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The wall-clock time at instant `at` (milliseconds) in `timezone`. */
export function localTime(at: number, timezone: string): LocalTime {
  const parts = new Map<string, number>();
  for (const part of formatter(timezone).formatToParts(new Date(at))) {
    if (part.type !== 'literal') parts.set(part.type, Number(part.value));
  }
  const field = (name: string) => parts.get(name) ?? 0;
  const [year, month, day] = [field('year'), field('month'), field('day')];
  const time = { hour: field('hour'), minute: field('minute'), second: field('second') };
  return { year, month, day, ...time, weekday: isoWeekday(year, month, day) };
}

/** How far `timezone`'s clock is ahead of UTC at instant `at`, in milliseconds. */
export function offsetAt(at: number, timezone: string): number {
  const local = localTime(at, timezone);
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a wall-clock time falls on in `timezone`: the date (a day past the month's end rolls over) and
 * `minutes` after its midnight. A time the clocks skip (spring forward) moves forward by the gap; a time they repeat
 * (fall back) is its first occurrence.
 */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timezone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  const before = offsetAt(wall - DAY_MS, timezone);
  const after = offsetAt(wall + DAY_MS, timezone);
  const valid = [wall - before, wall - after].filter((at) => at + offsetAt(at, timezone) === wall);
  return valid.length > 0 ? Math.min(...valid) : wall - Math.min(before, after);
}

/** Minutes after midnight of a `HH:MM` time. */
export function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The window of the local date `daysAgo` before `local`'s, when that date's weekday is a keep-on day. */
function windowOf(keepOn: KeepOnWindow, local: LocalTime, daysAgo: number): KeepOnSpan | null {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day - daysAgo));
  const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  if (!keepOn.days.includes(isoWeekday(year, month, day))) return null;
  const from = minutesOf(keepOn.from);
  const to = minutesOf(keepOn.to);
  const start = zonedInstant(year, month, day, from, keepOn.timezone);
  const end = zonedInstant(year, month, day + (to < from ? 1 : 0), to, keepOn.timezone);
  return { id: `${year}-${pad(month)}-${pad(day)}`, start: new Date(start), end: new Date(end) };
}

/**
 * The keep-on window `now` is in, or null (always null while the hours are off). Today's window and yesterday's (an
 * overnight one may still run) are checked by their instants, so a window's end and whether `now` is inside it always
 * agree, also on the days the clocks change.
 */
export function keepOnWindowAt(keepOn: KeepOnWindow, now: Date): KeepOnSpan | null {
  if (!keepOn.enabled) return null;
  const at = now.getTime();
  const local = localTime(at, keepOn.timezone);
  for (const daysAgo of [0, 1]) {
    const span = windowOf(keepOn, local, daysAgo);
    if (span !== null && span.start.getTime() <= at && at < span.end.getTime()) return span;
  }
  return null;
}
