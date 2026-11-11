import type { FlowStepKind } from '@mwc/shared/enums';
import type { Flow, PrincipalRef, TaskDetail, TaskEvent } from '../../../api/flows.ts';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { roundSpans, type TaskConversation } from '../conversations/model.ts';

/**
 * A task's story as its page tells it: its history cut into rounds (a round is one pass down the flow; it ends when the
 * task goes back to an earlier step, by a send-back, a retry or a route), each round the steps it went through with
 * what came of each, the step's hand-off note, files and conversation. The quiet rows (entered, started by itself) fold
 * into their step; people's actions and errors stay as small lines under it. Pure.
 */

/** What came of a step: its move out, or where it stands while the task is still there. */
export type Outcome =
  | 'handed_on'
  | 'passed'
  | 'approved'
  | 'sent_back'
  | 'escalated'
  | 'cancelled'
  | 'routed'
  | 'blocked'
  | 'turn_ended'
  | 'waiting'
  | 'working'
  | 'needs_person';

export interface StoryStep {
  /** Its `entered` row's id. */
  readonly id: string;
  readonly step: { readonly id: string; readonly name: string };
  readonly kind: FlowStepKind | undefined;
  /** Who the step is for (its assignee now), for the face. */
  readonly assignee: PrincipalRef | undefined;
  /** Its entries into this step so far, as the artifacts and conversations count them. */
  readonly stepRound: number | null;
  readonly at: string;
  /** The person's route or retry that brought it here, when it was one. */
  readonly arrival: TaskEvent | undefined;
  readonly outcome: Outcome;
  /** Who made the outcome (null: by itself, or still there). */
  readonly by: PrincipalRef | null;
  /** Where it went next. */
  readonly to: string | null;
  /** The send-back's, escalation's, cancel's, route's or turn's reason; null when a notice above says it already. */
  readonly reason: string | null;
  readonly endedAt: string | null;
  /** People's actions and errors while it was there (started, edited, blocked, a turn that ended). */
  readonly asides: readonly TaskEvent[];
  /** The person who started its turn, when that was the first thing at the step (said beside the step, not under it). */
  readonly startedBy: PrincipalRef | null;
  readonly note: TaskArtifact | undefined;
  /** Its files and links, then the files left out. */
  readonly files: readonly TaskArtifact[];
  readonly conversation: TaskConversation | undefined;
}

export interface StoryRound {
  readonly number: number;
  /** What happened before its first step: the creation and edits of a queued task. */
  readonly opening: readonly TaskEvent[];
  readonly steps: readonly StoryStep[];
  /** Done or cancelled at its end. */
  readonly end: TaskEvent | undefined;
}

export interface Story {
  readonly rounds: readonly StoryRound[];
  /** Rows after the last step ended (escalated and waiting for the Lead) or of a task that never entered a step. */
  readonly trailing: readonly TaskEvent[];
}

type Draft = { -readonly [K in keyof StoryStep]: StoryStep[K] } & { asides: TaskEvent[] };
type RoundDraft = { number: number; opening: TaskEvent[]; steps: Draft[]; end: TaskEvent | undefined };

const MOVE_OUT: Partial<Record<TaskEvent['kind'], Outcome>> = {
  handed_on: 'handed_on',
  passed: 'passed',
  signed_off: 'approved',
  sent_back: 'sent_back',
  escalated: 'escalated',
  routed: 'routed',
  retried: 'routed',
  cancelled: 'cancelled',
};

/** Where a step stands while the task is still at it, from the task's step state. */
const STANDING: Readonly<Record<NonNullable<TaskDetail['stepState']>, Outcome>> = {
  waiting: 'waiting',
  working: 'working',
  needs_person: 'needs_person',
  blocked: 'blocked',
  ended_without_handoff: 'turn_ended',
};

const close = (step: Draft, outcome: Outcome, event: TaskEvent) => {
  step.outcome = outcome;
  step.by = event.actor;
  step.to = event.to?.name ?? null;
  step.reason = event.reason;
  step.endedAt = event.at;
};

/** The last step left with nothing after it: where it stands now, its last error said once (the notice says it). */
function standing(step: Draft, task: TaskDetail) {
  if (task.state !== 'active' || task.step?.id !== step.step.id) return;
  const outcome = task.stepState ? STANDING[task.stepState] : 'waiting';
  step.outcome = outcome;
  const echo = outcome === 'blocked' ? 'blocked' : outcome === 'turn_ended' ? 'turn_ended' : undefined;
  const last = step.asides.at(-1);
  if (echo && last?.kind === echo) {
    step.asides.pop();
    step.by = last.actor;
    // A blocked step's reason is the Blocked notice's; a turn's end keeps its own.
    step.reason = echo === 'turn_ended' ? last.reason : null;
  }
}

/** The step's conversation: the one of its step whose rounds cover this entry. */
function conversationOf(task: TaskDetail, stepId: string, round: number | null) {
  const spans = roundSpans(task);
  return task.conversations.find((c) => {
    const span = spans.get(c.chatId);
    return (
      c.step.id === stepId && span !== undefined && round !== null && round >= span.from && round <= span.to
    );
  });
}

/** Builds the story from the task's history (oldest first), its flow and its artifacts. */
export function buildStory(
  task: TaskDetail,
  flow: Flow | null | undefined,
  artifacts: readonly TaskArtifact[],
): Story {
  const order = flow?.steps.map((s) => s.id) ?? [];
  const byPlace = Map.groupBy(artifacts, (a) => `${a.step.id}:${a.round}`);
  const rounds: RoundDraft[] = [];
  let open: Draft | undefined;
  let last: Draft | undefined;
  let carry: TaskEvent[] = [];
  const backward = (stepId: string) => {
    if (!last) return true;
    const [from, to] = [order.indexOf(last.step.id), order.indexOf(stepId)];
    if (from >= 0 && to >= 0) return to <= from;
    return (rounds.at(-1)?.steps ?? []).some((s) => s.step.id === stepId);
  };
  const enter = (event: TaskEvent) => {
    const stepId = event.to?.id ?? '';
    if (backward(stepId)) rounds.push({ number: rounds.length + 1, opening: [], steps: [], end: undefined });
    const round = rounds.at(-1) as RoundDraft;
    const move = carry.findLast((e) => e.kind === 'routed' || e.kind === 'retried');
    const rest = carry.filter((e) => e !== move);
    // An obvious route (out of the queue, no reason) folds into the step.
    const arrival = move && !isNoise(move) ? move : undefined;
    if (round.steps.length === 0) round.opening.push(...rest);
    const place = byPlace.get(`${stepId}:${event.round}`) ?? [];
    const step: Draft = {
      id: event.id,
      step: { id: stepId, name: event.to?.name ?? 'a step' },
      kind:
        flow?.steps.find((s) => s.id === stepId)?.kind ??
        task.rounds.find((r) => r.step.id === stepId)?.step.kind,
      assignee: flow?.steps.find((s) => s.id === stepId)?.assignee,
      stepRound: event.round,
      at: event.at,
      arrival,
      outcome: 'waiting',
      by: null,
      startedBy: null,
      to: null,
      reason: null,
      endedAt: null,
      asides: round.steps.length === 0 ? [] : rest,
      note: place.find((a) => a.kind === 'note'),
      files: [
        ...place.filter((a) => a.kind === 'file' || a.kind === 'link'),
        ...place.filter((a) => a.kind === 'skipped'),
      ],
      conversation: conversationOf(task, stepId, event.round),
    };
    round.steps.push(step);
    open = step;
    last = step;
    carry = [];
  };
  for (const event of task.history) {
    const out = MOVE_OUT[event.kind];
    const round = rounds.at(-1);
    if (event.kind === 'entered') enter(event);
    else if (event.kind === 'started' && event.actor === null) continue;
    else if (out && open) {
      close(open, out, event);
      open = undefined;
      if (event.kind === 'cancelled' && round) round.end = event;
    } else if ((event.kind === 'done' || event.kind === 'cancelled') && round) round.end = event;
    else if (open && event.kind === 'started' && open.asides.length === 0 && !open.startedBy)
      open.startedBy = event.actor;
    else if (open && out === undefined) open.asides.push(event);
    else carry.push(event);
  }
  if (open) standing(open, task);
  // An escalation's reason is the escalation notice's.
  if (task.state === 'escalated' && last?.outcome === 'escalated' && !open) last.reason = null;
  return { rounds, trailing: carry };
}

/** The first lines of a Markdown text, plain, for a one-line excerpt. */
export const plainExcerpt = (text: string): string =>
  text
    .split('\n')
    .map((line) =>
      line
        .replace(/^[#>*\-|\s]+/, '')
        .replace(/[`*_]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');

/** People's actions and noise in the raw log: the rows a quiet log hides. */
export const isNoise = (event: TaskEvent): boolean =>
  event.kind === 'entered' ||
  (event.kind === 'started' && event.actor === null) ||
  (event.kind === 'routed' && event.from === null && !event.reason);
