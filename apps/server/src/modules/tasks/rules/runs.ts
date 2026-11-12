import type { Task, TaskEvent } from '@mwc/db';
import { CHAT_TITLE, disconnectedWords } from '@mwc/shared/chats';
import type { ArtifactSkipReason, ChatTurnStatus, TaskStepState } from '@mwc/shared/enums';
import {
  ARTIFACT_LIMITS,
  type ArrivalKind,
  type StepHandoff,
  sizeWords,
  TASK_REASON_MAX,
} from '@mwc/shared/flows';
import { roundsAt, type StepRule, type TaskNow } from '../rules.ts';
import type { EventDraft } from './machine.ts';

// A step's run (S5.3b, docs/processes.md "Built in S5.3b"), pure: how the task came to the step this time (the prompt's
// hand-off), what a turn's end or a refused start makes of the task's step state, what a person's reply in the step's
// conversation does, a failed turn taken back (2026-11-12), a conversation's title and a skipped file's words. The
// service reads the rows and writes what these return.

/** The history rows that bring a task to a step, and how a prompt says it. */
const ARRIVALS: Readonly<Partial<Record<TaskEvent['kind'], ArrivalKind>>> = {
  handed_on: 'handed_on',
  passed: 'passed',
  signed_off: 'signed_off',
  sent_back: 'sent_back',
  routed: 'routed',
  retried: 'retried',
};

type HistoryRow = Pick<
  TaskEvent,
  'kind' | 'toStepId' | 'fromStepId' | 'fromStepName' | 'reason' | 'createdAt'
>;

/** How the task came to the step this time, and from which step (its id, for its reply), from the history. */
export function arrivalOf(
  history: readonly HistoryRow[],
  stepId: string,
): StepHandoff['arrival'] & { readonly fromStepId: string | null } {
  const row = history.findLast((event) => event.toStepId === stepId && ARRIVALS[event.kind] !== undefined);
  const kind = row === undefined ? undefined : ARRIVALS[row.kind];
  if (
    row === undefined ||
    kind === undefined ||
    (kind === 'routed' && row.fromStepId === null && !row.reason)
  ) {
    return { kind: 'new', from: null, fromStepId: null, reason: null };
  }
  return { kind, from: row.fromStepName, fromStepId: row.fromStepId, reason: row.reason };
}

/** When the task entered the step the time before this one; undefined on its first entry. */
export function previousEntryAt(history: readonly HistoryRow[], stepId: string): Date | undefined {
  const entries = history.filter((event) => event.kind === 'entered' && event.toStepId === stepId);
  return entries.at(-2)?.createdAt;
}

/** What a run makes of the task at its step: its new step state, why it is blocked, and its history row. */
export interface StepChange {
  readonly stepState: TaskStepState;
  readonly blockedReason: string | null;
  readonly event: EventDraft;
  /** True when it wakes nobody (S6c): a person stopped the turn, taking it over. */
  readonly quiet?: boolean;
}

const reasonOf = (text: string) =>
  text.length > TASK_REASON_MAX ? `${text.slice(0, TASK_REASON_MAX - 1)}…` : text;

/** Why the task is blocked, from a failure's text: cut to a reason's length, "The turn failed" for none. */
const blockReason = (text: string) => reasonOf(text.trim() || 'The turn failed');

/** A failed turn's error as a blocked task says it: the words of `machine_disconnected: <words>`, else as it is. */
export const failureText = (error: string | null): string =>
  error === null ? 'The turn failed' : (disconnectedWords(error) ?? error);

/** True while the task is active at the step and being worked on there. */
const workingAt = (task: TaskNow, step: StepRule) =>
  task.state === 'active' && task.currentStepId === step.id && task.stepState === 'working';

/** The task blocked at the step (its turn could not start, or failed), by itself; undefined once it moved. */
export function blocked(task: TaskNow, step: StepRule, reason: string): StepChange | undefined {
  if (!workingAt(task, step)) return undefined;
  const round = roundsAt(task.rounds, step.id).entries;
  const why = blockReason(reason);
  return {
    stepState: 'blocked',
    blockedReason: why,
    event: { kind: 'blocked', system: true, to: step, round, reason: why },
  };
}

/**
 * What a turn's end makes of the task, while it is still being worked on at the step: a failed turn blocks it with its
 * error; one that finished (or a person stopped) leaves it `ended_without_handoff`, for a person to move or answer.
 */
export function turnEnded(
  task: TaskNow,
  step: StepRule,
  end: { readonly status: ChatTurnStatus; readonly error: string | null },
): StepChange | undefined {
  if (end.status === 'failed') return blocked(task, step, failureText(end.error));
  if (!workingAt(task, step)) return undefined;
  const round = roundsAt(task.rounds, step.id).entries;
  const stopped = end.status === 'stopped';
  const reason = stopped ? 'The turn was stopped' : undefined;
  return {
    stepState: 'ended_without_handoff',
    blockedReason: null,
    event: { kind: 'turn_ended', system: true, to: step, round, reason },
    ...(stopped ? { quiet: true } : {}),
  };
}

/** The history row a taken-back turn's task says it carries on with. */
export const CARRIED_ON = 'The machine came back with the turn; it goes on';

/**
 * A step's turn that failed because its runner was away, taken back when that runner came back with it (2026-11-12):
 * the task works at the step again, while that failure blocked it (its reason, as `turnEnded` wrote it) and nothing
 * happened to it since (the block is its latest history row but edits); undefined otherwise. Wakes nobody.
 */
export function carriedOn(
  task: TaskNow & Pick<Task, 'blockedReason'>,
  step: StepRule,
  error: string | null,
  history: readonly Pick<TaskEvent, 'kind' | 'toStepId' | 'reason'>[],
): StepChange | undefined {
  const reason = blockReason(failureText(error));
  const last = history.findLast((event) => event.kind !== 'edited');
  const blockedBy = task.stepState === 'blocked' && task.blockedReason === reason;
  if (task.state !== 'active' || task.currentStepId !== step.id || !blockedBy) return undefined;
  if (last?.kind !== 'blocked' || last.toStepId !== step.id || last.reason !== reason) return undefined;
  const round = roundsAt(task.rounds, step.id).entries;
  return {
    stepState: 'working',
    blockedReason: null,
    event: { kind: 'started', system: true, to: step, round, reason: CARRIED_ON },
    quiet: true,
  };
}

const STARTABLE: readonly (TaskStepState | null)[] = ['waiting', 'blocked', 'ended_without_handoff'];

/**
 * A person's message in the step's conversation started a turn: while the task is at the step and not being worked on,
 * it is now (a start by them); undefined otherwise (it moved on, or a turn already works on it).
 */
export function replyStarted(task: TaskNow, step: StepRule): StepChange | undefined {
  if (task.state !== 'active' || task.currentStepId !== step.id || !STARTABLE.includes(task.stepState)) {
    return undefined;
  }
  return { stepState: 'working', blockedReason: null, event: { kind: 'started', to: step } };
}

/** A step conversation's title: `T-12 · Develop · Fix the login`, cut to a chat title's length. */
export function conversationTitle(key: string, step: string, title: string): string {
  const text = `${key} · ${step} · ${title}`.replace(/\s+/g, ' ').trim();
  return text.length <= CHAT_TITLE.max ? text : `${text.slice(0, CHAT_TITLE.max - 1).trimEnd()}…`;
}

const SKIP_WORDS: Readonly<Record<ArtifactSkipReason, string>> = {
  too_large: `Not collected: over the ${sizeWords(ARTIFACT_LIMITS.fileBytes)} a file may be`,
  binary: 'Not collected: neither text nor an image',
  too_many: `Not collected: over the ${ARTIFACT_LIMITS.files} files a turn collects`,
  total_limit: `Not collected: over the ${sizeWords(ARTIFACT_LIMITS.totalBytes)} a turn collects`,
  unreadable: 'Not collected: the runner could not read it',
};

/** Why a file was not collected, in words (a skipped artifact's note). */
export const skipWords = (reason: ArtifactSkipReason): string => SKIP_WORDS[reason];

/** The replacement character a cut through a UTF-8 sequence decodes to. */
const BROKEN = String.fromCharCode(0xfffd);

/** A hand-off note's bytes: the reply as UTF-8, cut to an artifact's 2 MB on a character, never inside one. */
export function noteBytes(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= ARTIFACT_LIMITS.fileBytes) return bytes;
  const cut = new TextDecoder().decode(bytes.subarray(0, ARTIFACT_LIMITS.fileBytes));
  return new TextEncoder().encode(cut.endsWith(BROKEN) ? cut.slice(0, -1) : cut);
}
