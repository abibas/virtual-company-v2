import { useEffect, useState } from 'react';
import type { LimitWindow, SubscriptionLimits } from '../../api/types.ts';
import {
  formatDateTime,
  formatDuration,
  formatTime,
  formatWeekdayTime,
} from '../../components/data/format.ts';
import type { MeterTone } from '../../components/data/Meter.tsx';

/**
 * How a subscription's limits read (`GET /api/me/subscriptions/limits`): which windows are the main ones, the colour
 * of a bar, the reading and the line under it, and where the numbers came from.
 */

/** The share of a window from which its bar turns amber. */
export const WARN_AT = 80;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 5-hour and the weekly windows, shown as full rows. */
const MAIN: Readonly<Record<string, string>> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  weekly: 'Weekly',
};

/** A per-model window's id (`seven_day_fable`, `five_hour_opus`): its length and its model. */
const MODEL_WINDOW = /^(five_hour|seven_day)_([a-z0-9]+)$/;

export interface NamedWindow {
  readonly name: string;
  readonly window: LimitWindow;
}

/** A per-model window's short name: "Fable" for a weekly one, "Fable 5h" for a 5-hour one. */
function modelName(id: string): string | undefined {
  const [, length, model] = MODEL_WINDOW.exec(id) ?? [];
  if (!model) return undefined;
  const name = `${model.charAt(0).toUpperCase()}${model.slice(1)}`;
  return length === 'five_hour' ? `${name} 5h` : name;
}

const named = (
  limits: SubscriptionLimits,
  nameOf: (id: string) => string | undefined,
): readonly NamedWindow[] =>
  limits.windows.flatMap((window) => {
    const name = nameOf(window.id);
    return name ? [{ name, window }] : [];
  });

/** The 5-hour and weekly windows, in the provider's order. */
export const mainWindows = (limits: SubscriptionLimits) => named(limits, (id) => MAIN[id]);

/** The per-model windows (Opus, Sonnet, Fable, … whatever the provider reports). */
export const modelWindows = (limits: SubscriptionLimits) => named(limits, modelName);

/** Whether a window's reset time has passed: its reading is from before the reset, so it is being checked again. */
export const resetPassed = (window: LimitWindow, now: number) =>
  window.resetsAt !== null && new Date(window.resetsAt).getTime() <= now;

/**
 * A bar's colour: grey for an old reading (stale, or its reset has passed), red when the limit is reached, amber
 * from 80%, else the brand blue.
 */
export function meterTone(window: LimitWindow, stale: boolean, now: number): MeterTone {
  if (stale || resetPassed(window, now)) return 'pending';
  if (window.reached) return 'failed';
  return window.usedPercent >= WARN_AT ? 'input' : 'blue';
}

/** The share used, rounded ("18%"); a little use is "<1%", not 0%. */
export function percentText(usedPercent: number): string {
  if (usedPercent > 0 && usedPercent < 1) return '<1%';
  return `${Math.round(usedPercent)}%`;
}

/** When a window resets: "resets in 1h 56m" within a day, "resets Tue, Nov 10, 6:00 PM" later; none when unknown. */
export function resetText(resetsAt: string | null, now: number): string | undefined {
  if (!resetsAt) return undefined;
  const left = new Date(resetsAt).getTime() - now;
  if (left <= 0) return undefined;
  if (left < DAY_MS) return `resets in ${formatDuration(left)}`;
  return `resets ${formatWeekdayTime(resetsAt)}`;
}

/** What a window whose reset has passed says until the next check: never its old share. */
export const UPDATING = 'updating…';

/** The percentage column: the share used ("18%"), or "—" while the window is being checked again after its reset. */
export function readingText(window: LimitWindow, now: number): string {
  return resetPassed(window, now) ? '—' : percentText(window.usedPercent);
}

/**
 * The line under a bar: "resets in 1h 56m", "Limit reached · resets …", "updating…" after its reset; none when the
 * reset is unknown.
 */
export function detailText(window: LimitWindow, now: number): string | undefined {
  if (resetPassed(window, now)) return UPDATING;
  const reset = resetText(window.resetsAt, now);
  if (!window.reached) return reset;
  return reset ? `Limit reached · ${reset}` : 'Limit reached';
}

/** Where the numbers come from, said plainly. */
function sourceName(limits: SubscriptionLimits): string {
  if (limits.source === 'message_headers') return 'Read from the last request’s limits';
  if (limits.source === 'none') return 'No limits (pay as you go)';
  return limits.kind === 'codex_oauth' ? 'Live from OpenAI' : 'Live from Anthropic';
}

/** "Live from Anthropic, checked at 10:42"; the day too when it was not today. */
export function sourceText(limits: SubscriptionLimits, now: number): string {
  const source = sourceName(limits);
  if (limits.source === 'none') return source;
  if (!limits.checkedAt) return `${source}, not checked yet`;
  const today = new Date(limits.checkedAt).toDateString() === new Date(now).toDateString();
  return `${source}, checked ${today ? `at ${formatTime(limits.checkedAt)}` : formatDateTime(limits.checkedAt)}`;
}

/** The time now, again every `everyMs` (30 seconds by default), so "resets in" lines stay true on an open page. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
