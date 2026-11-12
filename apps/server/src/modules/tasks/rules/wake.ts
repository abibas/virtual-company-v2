import type { Flow } from '@mwc/db';
import type { LeadWakeKind, LeadWakeOutcome } from '@mwc/shared/enums';
import { clipLine, LEAD_WAKE_REASON_MAX, type LeadEventKind, type LeadWakeSettings } from '@mwc/shared/flows';
import type { TaskNow } from '../rules.ts';
import type { StepChange } from './runs.ts';

// A flow's Lead wakes up by itself (S6c, docs/processes.md "Built: the Lead wakes up"), pure: which events of a task
// wake an agent Lead and when its flow's settings let them, whether an event is still what the task is when its wake-up
// goes, the window that coalesces a flow's events, the caps, and when the Lead's nearest person is told instead.

/** A flow's settings as the API shows them. */
export const settingsOf = (flow: Flow): LeadWakeSettings => ({
  escalated: flow.wakeEscalated,
  blocked: flow.wakeBlocked,
  turnEnded: flow.wakeTurnEnded,
  done: flow.wakeDone,
  signoffHours: flow.wakeSignoffHours,
  windowSeconds: flow.wakeWindowSeconds,
  maxPerHour: flow.wakeMaxPerHour,
  maxPerDay: flow.wakeMaxPerDay,
  checkInMinutes: flow.wakeCheckInMinutes,
});

/** The flow's columns for these settings. */
export const settingsColumns = (settings: LeadWakeSettings) => ({
  wakeEscalated: settings.escalated,
  wakeBlocked: settings.blocked,
  wakeTurnEnded: settings.turnEnded,
  wakeDone: settings.done,
  wakeSignoffHours: settings.signoffHours,
  wakeWindowSeconds: settings.windowSeconds,
  wakeMaxPerHour: settings.maxPerHour,
  wakeMaxPerDay: settings.maxPerDay,
  wakeCheckInMinutes: settings.checkInMinutes,
});

/** True when the flow's settings wake its Lead for this kind of event. */
export function wakesOn(flow: Flow, kind: LeadWakeKind): boolean {
  const on: Readonly<Record<LeadWakeKind, boolean>> = {
    escalated: flow.wakeEscalated,
    blocked: flow.wakeBlocked,
    turn_ended: flow.wakeTurnEnded,
    done: flow.wakeDone,
    signoff_waiting: flow.wakeSignoffHours !== null,
    check_in: flow.wakeCheckInMinutes !== null,
  };
  return on[kind];
}

/** The event a move makes: an escalation, or a task done. */
export function moveWake(outcome: string): LeadEventKind | undefined {
  if (outcome === 'escalated') return 'escalated';
  return outcome === 'done' ? 'done' : undefined;
}

/**
 * The event a step's run makes: blocked, or its turn ended without a hand-off; none for a turn a person stopped (they
 * took it over) or a start.
 */
export function changeWake(change: StepChange): LeadEventKind | undefined {
  if (change.quiet) return undefined;
  if (change.stepState === 'blocked') return 'blocked';
  return change.stepState === 'ended_without_handoff' ? 'turn_ended' : undefined;
}

/** A reason as a wake-up keeps it: one line, clipped; null for none. */
export const wakeReason = (reason: string | null | undefined): string | null =>
  reason === null || reason === undefined || reason.trim() === ''
    ? null
    : clipLine(reason, LEAD_WAKE_REASON_MAX);

/** True while the task still is what the event said when it is told: a person may have moved it meanwhile. */
export function stillCurrent(kind: LeadEventKind, task: Pick<TaskNow, 'state' | 'stepState'>): boolean {
  if (kind === 'escalated') return task.state === 'escalated';
  if (kind === 'done') return task.state === 'done';
  const want = { blocked: 'blocked', turn_ended: 'ended_without_handoff', signoff_waiting: 'needs_person' }[
    kind
  ];
  return task.state === 'active' && task.stepState === want;
}

/** True once the flow's quiet window after its oldest seen event has passed. */
export const windowPassed = (oldestSeen: Date, windowSeconds: number, now: Date): boolean =>
  oldestSeen.getTime() + windowSeconds * 1000 <= now.getTime();

/** How many wake-ups the Lead had in the last hour and the last day. */
export interface WakeCounts {
  readonly hour: number;
  readonly day: number;
}

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

/** The cap a new wake-up would pass: this hour's, else today's; undefined when it may go. */
export function capReached(
  counts: WakeCounts,
  settings: Pick<LeadWakeSettings, 'maxPerHour' | 'maxPerDay'>,
): 'hour_cap' | 'day_cap' | undefined {
  if (counts.hour >= settings.maxPerHour) return 'hour_cap';
  return counts.day >= settings.maxPerDay ? 'day_cap' : undefined;
}

/**
 * True when a wake-up that did not reach the Lead tells its nearest person: once, the first time it is held for this
 * reason since the Lead was last told (the flow's previous outcome was not this one).
 */
export const tellsPerson = (previous: LeadWakeOutcome | undefined, outcome: LeadWakeOutcome): boolean =>
  (outcome === 'capped' || outcome === 'unreachable') && previous !== outcome;

/** The hours a task has waited, whole, at least one. */
export const hoursSince = (since: Date, now: Date): number =>
  Math.max(1, Math.floor((now.getTime() - since.getTime()) / HOUR_MS));
