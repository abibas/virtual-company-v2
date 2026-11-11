import type { TaskAction, TaskEventKind, TaskStepState } from '@mwc/shared/enums';
import { TASK_REASON_MAX } from '@mwc/shared/flows';
import { inOrder, type Refusal, refuse, roundsAt, type StepRule, type TaskNow } from '../rules.ts';
import { moveRefusal } from './moves.ts';

export type { TaskNow } from '../rules.ts';

// What each move makes of a task (docs/processes.md, "Task states"): one straight row of steps, `send_back` the only
// way back, the last step's pass or approval closing it, a send-back over its step's limit escalating it to the Lead,
// and the Lead's moves. Pure: the service reads the task and its flow's steps, and writes what this returns.

/** A move as asked: the action, the step a `route` goes to, and why. */
export interface MoveInput {
  readonly action: TaskAction;
  readonly toStepId?: string | undefined;
  readonly reason?: string | undefined;
}

/** One history row to write; `system` rows have no actor (a step that starts by itself). */
export interface EventDraft {
  readonly kind: TaskEventKind;
  readonly system?: boolean;
  readonly from?: StepRule | undefined;
  readonly to?: StepRule | undefined;
  readonly round?: number;
  readonly reason?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** What a move makes: the task after it, its history rows, the step it entered (its assignee hears of it). */
export interface Transition {
  readonly ok: true;
  readonly task: TaskNow;
  readonly events: readonly EventDraft[];
  readonly outcome: 'started' | 'moved' | 'done' | 'escalated' | 'cancelled';
  readonly entered: StepRule | null;
}

/** Who the rules ask about an assignee: a person (a person's Sign-off waits for them) or an agent. */
export type IsPerson = (principalId: string) => boolean;

const OUTCOME_KIND: Readonly<Record<'hand_on' | 'pass' | 'approve', TaskEventKind>> = {
  hand_on: 'handed_on',
  pass: 'passed',
  approve: 'signed_off',
};
/** The task once it entered `step`: its round there, its state (a person's Sign-off waits for them; `auto` starts). */
function enter(task: TaskNow, step: StepRule, isPerson: IsPerson) {
  const round = roundsAt(task.rounds, step.id).entries + 1;
  const rounds = { ...task.rounds, [step.id]: { ...roundsAt(task.rounds, step.id), entries: round } };
  const waitsForPerson = step.kind === 'signoff' && isPerson(step.assigneePrincipalId);
  const starts = !waitsForPerson && step.starts === 'auto';
  const stepState: TaskStepState = waitsForPerson ? 'needs_person' : starts ? 'working' : 'waiting';
  const events: EventDraft[] = [{ kind: 'entered', to: step, round }];
  if (starts) events.push({ kind: 'started', system: true, to: step });
  const after: TaskNow = {
    state: 'active',
    currentStepId: step.id,
    stepState,
    rounds,
    escalationReason: null,
    escalationTargetStepId: null,
  };
  return { task: after, events };
}

/** The task closed (done or cancelled): no step, no escalation. */
const closed = (task: TaskNow, state: 'done' | 'cancelled'): TaskNow => ({
  ...task,
  state,
  currentStepId: null,
  stepState: null,
  escalationReason: null,
  escalationTargetStepId: null,
});

/** The escalation's sentence: the step, its limit, and this send-back's reason, cut to fit. */
function escalationReason(step: StepRule, limit: number, reason: string): string {
  const times = limit === 1 ? 'once' : `${limit} times`;
  const text = `${step.name} sent it back ${times} already, its limit; this time: ${reason}`;
  return text.length > TASK_REASON_MAX ? `${text.slice(0, TASK_REASON_MAX - 1)}…` : text;
}

/** A send-back from `from`: back to its target for another round, or, over its limit, to the Lead. */
function sendBack(task: TaskNow, from: StepRule, target: StepRule, reason: string, isPerson: IsPerson) {
  const { sendBacks } = roundsAt(task.rounds, from.id);
  if (from.sendBackLimit !== null && sendBacks >= from.sendBackLimit) {
    const escalated: TaskNow = {
      ...task,
      state: 'escalated',
      stepState: null,
      escalationReason: escalationReason(from, from.sendBackLimit, reason),
      escalationTargetStepId: target.id,
    };
    const details = { code: 'limit_reached', limit: from.sendBackLimit, sendBacks };
    const events: EventDraft[] = [{ kind: 'escalated', from, to: target, reason, details }];
    return { ok: true as const, task: escalated, events, outcome: 'escalated' as const, entered: null };
  }
  const counted = {
    ...task.rounds,
    [from.id]: { ...roundsAt(task.rounds, from.id), sendBacks: sendBacks + 1 },
  };
  const entered = enter({ ...task, rounds: counted }, target, isPerson);
  const events: EventDraft[] = [{ kind: 'sent_back', from, to: target, reason }, ...entered.events];
  return { ok: true as const, task: entered.task, events, outcome: 'moved' as const, entered: target };
}

/** The step's outcome forward: into the next step, or done after the last one. */
function forward(
  task: TaskNow,
  steps: readonly StepRule[],
  from: StepRule,
  action: 'hand_on' | 'pass' | 'approve',
  isPerson: IsPerson,
): Transition {
  const ordered = inOrder(steps);
  const next = ordered[ordered.findIndex((step) => step.id === from.id) + 1];
  if (next === undefined) {
    const events: EventDraft[] = [
      { kind: OUTCOME_KIND[action], from },
      { kind: 'done', from },
    ];
    return { ok: true, task: closed(task, 'done'), events, outcome: 'done', entered: null };
  }
  const entered = enter(task, next, isPerson);
  const events: EventDraft[] = [{ kind: OUTCOME_KIND[action], from, to: next }, ...entered.events];
  return { ok: true, task: entered.task, events, outcome: 'moved', entered: next };
}

/**
 * What a move makes of the task (after `moveRefusal`, and after the caller was allowed to make it), or its refusal:
 * a send-back without a reason (422 `reason_required`), a route without a step (422 `step_required`) or to a step of
 * no step of this flow (422 `unknown_step`), or to the step an active task is at (409 `already_at_step`).
 */
export function move(
  task: TaskNow,
  steps: readonly StepRule[],
  input: MoveInput,
  isPerson: IsPerson,
): Transition | Refusal<409 | 422> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const current = task.currentStepId === null ? undefined : byId.get(task.currentStepId);
  const refused = moveRefusal(task, current, input.action);
  if (refused) return refused;
  const reason = input.reason?.trim() || undefined;
  const action = input.action;
  if (action === 'start') {
    const started: TaskNow = { ...task, stepState: 'working' };
    return {
      ok: true,
      task: started,
      events: [{ kind: 'started', to: current }],
      outcome: 'started',
      entered: null,
    };
  }
  if (action === 'cancel') {
    const events: EventDraft[] = [{ kind: 'cancelled', from: current, reason }];
    return { ok: true, task: closed(task, 'cancelled'), events, outcome: 'cancelled', entered: null };
  }
  if (action === 'send_back') {
    if (reason === undefined) return refuse(422, 'reason_required', 'Say why the task goes back');
    const target = byId.get((current as StepRule).sendsBackToStepId as string);
    if (target === undefined) return refuse(422, 'no_send_back_target', 'The send-back target is gone');
    return sendBack(task, current as StepRule, target, reason, isPerson);
  }
  if (action === 'route' || action === 'retry')
    return reroute(task, byId, current, { ...input, reason }, isPerson);
  return forward(task, steps, current as StepRule, action, isPerson);
}

/** The Lead's moves into a step: `route` (to the step asked) and `retry` (to the send-back an escalation stopped). */
function reroute(
  task: TaskNow,
  byId: ReadonlyMap<string, StepRule>,
  current: StepRule | undefined,
  input: MoveInput,
  isPerson: IsPerson,
): Transition | Refusal<409 | 422> {
  let rounds = task.rounds;
  let wanted = input.toStepId;
  if (input.action === 'retry') {
    // Into the step the stopped send-back was going to (else the step it escalated from), which gets a fresh count.
    wanted = task.escalationTargetStepId ?? task.currentStepId ?? undefined;
    if (current) rounds = { ...rounds, [current.id]: { ...roundsAt(rounds, current.id), sendBacks: 0 } };
  }
  if (wanted === undefined) return refuse(422, 'step_required', 'Say which step the task goes to');
  const to = byId.get(wanted);
  if (to === undefined) return refuse(422, 'unknown_step', 'No such step in this flow');
  if (task.state === 'active' && to.id === task.currentStepId) {
    return refuse(409, 'already_at_step', `The task is at "${to.name}" already`);
  }
  const entered = enter({ ...task, rounds }, to, isPerson);
  const kind = input.action === 'retry' ? 'retried' : 'routed';
  const events: EventDraft[] = [{ kind, from: current, to, reason: input.reason }, ...entered.events];
  return { ok: true, task: entered.task, events, outcome: 'moved', entered: to };
}
