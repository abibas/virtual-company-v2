import type { LeadWakeKind } from './enums.ts';

/**
 * A flow's Lead wakes up by itself (S6c, docs/processes.md "Built: the Lead wakes up"): what the flow's settings allow,
 * their defaults, and the short message a wake-up queues in the Lead's team chat. The message helps the Lead act: per
 * task its key and title, the step, what happened (the reason clipped) and the decision expected, with the tools'
 * names. Pure.
 */

/**
 * The settings' bounds: the quiet window that coalesces events, the caps on wake-ups (check-ins count too: twelve an
 * hour lets 5-minute check-ins through, 150 a day a working day of them), a sign-off's waiting hours, and the minutes
 * between check-ins while the flow has work.
 */
export const LEAD_WAKE = {
  windowSeconds: { min: 0, max: 600, default: 60 },
  perHour: { min: 1, max: 60, default: 12 },
  perDay: { min: 1, max: 500, default: 150 },
  signoffHours: { min: 1, max: 168 },
  checkInMinutes: { min: 3, max: 60, default: 5 },
} as const;

/** The check-in intervals the flow's settings offer, in minutes (or off). */
export const LEAD_CHECK_IN_CHOICES = [3, 5, 10, 15, 30] as const;

/** What a wake-up quotes of a reason (a send-back's, a block's). */
export const LEAD_WAKE_REASON_MAX = 300;
/** What it quotes of a task's title. */
export const LEAD_WAKE_TITLE_MAX = 80;
/** The tasks one message lists; the rest are counted, for `team_board`. */
export const LEAD_WAKE_LISTED = 10;

/** A flow's Lead wake-up settings: the events that wake it, the window and the caps. */
export interface LeadWakeSettings {
  readonly escalated: boolean;
  readonly blocked: boolean;
  readonly turnEnded: boolean;
  readonly done: boolean;
  /** Wake it when a task has waited this many hours for a person's sign-off; null: never. */
  readonly signoffHours: number | null;
  readonly windowSeconds: number;
  readonly maxPerHour: number;
  readonly maxPerDay: number;
  /** Check in with the Lead every this many minutes while its flow has work; null: never. */
  readonly checkInMinutes: number | null;
}

/** On for escalated, blocked and a turn ended; off for done and a sign-off's wait; a check-in every 5 minutes. */
export const LEAD_WAKE_DEFAULTS: LeadWakeSettings = {
  escalated: true,
  blocked: true,
  turnEnded: true,
  done: false,
  signoffHours: null,
  windowSeconds: LEAD_WAKE.windowSeconds.default,
  maxPerHour: LEAD_WAKE.perHour.default,
  maxPerDay: LEAD_WAKE.perDay.default,
  checkInMinutes: LEAD_WAKE.checkInMinutes.default,
};

/** The kinds of a task's event (a check-in is of no one task: `check-in.ts`). */
export type LeadEventKind = Exclude<LeadWakeKind, 'check_in'>;

/** One event a wake-up tells. */
export interface LeadWakeItem {
  readonly kind: LeadEventKind;
  readonly task: { readonly key: string; readonly title: string };
  /** The step it happened at (escalated from, blocked at, ended at, waits at); null for none. */
  readonly step: string | null;
  readonly reason: string | null;
  /** A sign-off's wait: whom it waits for and how many hours so far. */
  readonly waiting?: { readonly who: string; readonly hours: number } | undefined;
}

/** A wake-up's message: the flow, the person the Lead may ask (null: "a person"), the events in order. */
export interface LeadWakeInput {
  readonly flow: string;
  readonly person: string | null;
  readonly events: readonly LeadWakeItem[];
}

/** Whitespace folded to one space, cut to `max` with an ellipsis. */
export function clipLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

const named = (item: LeadWakeItem) => `${item.task.key} “${clipLine(item.task.title, LEAD_WAKE_TITLE_MAX)}”`;
const at = (item: LeadWakeItem, word: string) => (item.step === null ? '' : ` ${word} ${item.step}`);
const why = (item: LeadWakeItem) =>
  item.reason === null || item.reason.trim() === '' ? '' : `: ${clipLine(item.reason, LEAD_WAKE_REASON_MAX)}`;

/** What happened, one line per kind (done is the digest's). */
const HAPPENED: Readonly<Record<Exclude<LeadEventKind, 'done'>, (item: LeadWakeItem) => string>> = {
  escalated: (item) => `${named(item)} was escalated to you${at(item, 'from')}${why(item)}`,
  blocked: (item) => `${named(item)} is blocked${at(item, 'at')}${why(item)}`,
  turn_ended: (item) => `${named(item)}: its turn ended${at(item, 'at')} without a hand-off${why(item)}`,
  signoff_waiting: (item) =>
    `${named(item)} has waited ${item.waiting?.hours ?? 0} h for ${item.waiting?.who ?? 'a person'}'s sign-off${at(item, 'at')}`,
};

/** The decision expected, with the tools that make it. */
const DECIDE: Readonly<Record<Exclude<LeadEventKind, 'done'>, (ask: string) => string>> = {
  escalated: (ask) => `Decide: task_retry / task_route / task_cancel, or ${ask}.`,
  blocked: (ask) => `Decide: fix the cause, then task_start; or task_route / task_cancel, or ${ask}.`,
  turn_ended: (ask) => `Decide: task_show, then task_start / task_route / task_cancel, or ${ask}.`,
  signoff_waiting: () => 'Decide: remind them (ask_user_question), or leave it.',
};

/** The latest event of each task and kind, in the order they came. */
function latestOnly(events: readonly LeadWakeItem[]): LeadWakeItem[] {
  const key = (item: LeadWakeItem) => `${item.task.key}:${item.kind}`;
  const last = new Map(events.map((item, index) => [key(item), index]));
  return events.filter((item, index) => last.get(key(item)) === index);
}

/** How every wake-up ends: act now, then end the turn rather than wait (Most Wanted wakes the Lead again). */
export const LEAD_WAKE_CLOSING =
  'Act with your tools now, then end your turn: never wait for a step’s agent, Most Wanted wakes you again. ' +
  'team_board shows the whole board. Keep your reply to a line or two.';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The first line: the flow, and what waits for the Lead. */
function headline(flow: string, decisions: number, done: number): string {
  const parts = [
    ...(decisions > 0 ? [`${plural(decisions, 'task needs', 'tasks need')} your decision`] : []),
    ...(done > 0 ? [`${plural(done, 'task is', 'tasks are')} done`] : []),
  ];
  return `Most Wanted · ${clipLine(flow, 80)}: ${parts.join('; ')}.`;
}

/**
 * The wake-up's message (see above): a headline, then each task that needs a decision as two lines (what happened, the
 * decision with its tools), the done tasks as one digest line, and a closing line naming the board. At most
 * `LEAD_WAKE_LISTED` tasks are listed, the rest counted; a task's repeated event of the same kind is told once (its
 * latest). Empty events make an empty string.
 */
export function leadWakeMessage(input: LeadWakeInput): string {
  const events = latestOnly(input.events);
  if (events.length === 0) return '';
  const ask = `ask ${input.person === null ? 'a person' : clipLine(input.person, 60)} (ask_user_question)`;
  const decisions = events.filter((item) => item.kind !== 'done');
  const done = events.filter((item) => item.kind === 'done');
  const listed = decisions.slice(0, LEAD_WAKE_LISTED);
  const doneRoom = Math.max(0, LEAD_WAKE_LISTED - listed.length);
  const lines = [headline(input.flow, decisions.length, done.length), ''];
  for (const item of listed) {
    const kind = item.kind as Exclude<LeadEventKind, 'done'>;
    lines.push(`- ${HAPPENED[kind](item)}`, `  ${DECIDE[kind](ask)}`);
  }
  if (done.length > 0) {
    const shown = done.slice(0, Math.max(1, doneRoom)).map(named);
    const more = done.length - shown.length;
    lines.push(`- Done: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`);
  }
  const hidden = decisions.length - listed.length;
  if (hidden > 0)
    lines.push(`- And ${plural(hidden, 'more task', 'more tasks')}: read them with team_board.`);
  lines.push('', LEAD_WAKE_CLOSING);
  return lines.join('\n');
}
