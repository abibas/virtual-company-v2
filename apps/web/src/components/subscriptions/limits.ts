import { useEffect, useState } from 'react';
import type { LimitWindow, SubscriptionLimits } from '../../api/types.ts';
import { formatDateTime, formatDuration, formatTime, formatWeekdayTime } from '../data/format.ts';
import type { MeterTone } from '../data/Meter.tsx';

/**
 * How a subscription's limits read (`GET /api/me/subscriptions/limits`): which windows are the main ones, the colour
 * of a bar, the line beside it, and where the numbers came from.
 */

/** The share of a window from which its bar turns amber. */
export const WARN_AT = 80;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 5-hour and the weekly windows, shown as full rows. */
const MAIN: Readonly<Partial<Record<LimitWindow['id'], string>>> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  weekly: 'Weekly',
};

/** Claude's per-model weekly windows, shown as compact rows when the provider gives them. */
const MODELS: Readonly<Partial<Record<LimitWindow['id'], string>>> = {
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
};

export interface NamedWindow {
  readonly name: string;
  readonly window: LimitWindow;
}

const named = (table: typeof MAIN, limits: SubscriptionLimits): readonly NamedWindow[] =>
  limits.windows.flatMap((window) => {
    const name = table[window.id];
    return name ? [{ name, window }] : [];
  });

/** The 5-hour and weekly windows, in the provider's order. */
export const mainWindows = (limits: SubscriptionLimits) => named(MAIN, limits);

/** The per-model weekly windows (Opus, Sonnet). */
export const modelWindows = (limits: SubscriptionLimits) => named(MODELS, limits);

/** A bar's colour: grey for an old reading, red when the limit is reached, amber from 80%, else the brand blue. */
export function meterTone(window: LimitWindow, stale: boolean): MeterTone {
  if (stale) return 'pending';
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
  if (left <= 0) return 'resets now';
  if (left < DAY_MS) return `resets in ${formatDuration(left)}`;
  return `resets ${formatWeekdayTime(resetsAt)}`;
}

/** The line beside a bar: "18% · resets in 1h 56m", "Limit reached · resets …". */
export function windowLine(window: LimitWindow, now: number): string {
  const share = window.reached ? 'Limit reached' : percentText(window.usedPercent);
  return [share, resetText(window.resetsAt, now)].filter(Boolean).join(' · ');
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

/** The time now, again every `everyMs` (a minute by default), so "resets in" lines stay true on an open page. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
