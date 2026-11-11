import { type FlowStep, isUuid, type Task, type TaskRounds } from '@mwc/db';
import type { TaskPriority, TaskState, TaskStepState } from '@mwc/shared/enums';
import { taskNumber } from '@mwc/shared/flows';

// The tasks module's pure rules (S5.3a, docs/processes.md): the refusals the routes answer, the step and task shapes
// the rules read, and a task's reference. The parts: `rules/steps.ts` (a flow's step list), `rules/moves.ts` (which
// moves a task has), `rules/machine.ts` (what each move makes of it), `rules/access.ts` (who may make it) and
// `rules/notices.ts` (whom it tells).

export type RefusalStatus = 403 | 404 | 409 | 422;

/** A refusal the routes answer in the common error shape, typed by its status so a route documents each one. */
export interface Refusal<S extends RefusalStatus = RefusalStatus> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

export const refuse = <S extends RefusalStatus>(status: S, code: string, message: string): Refusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

export const FLOW_NOT_FOUND = refuse(404, 'flow_not_found', 'No such flow in this company');
export const TASK_NOT_FOUND = refuse(404, 'task_not_found', 'No such task in this company');

/** A step as the rules read it. */
export type StepRule = Pick<
  FlowStep,
  | 'id'
  | 'position'
  | 'name'
  | 'kind'
  | 'assigneePrincipalId'
  | 'starts'
  | 'sendsBackToStepId'
  | 'sendBackLimit'
>;

/** A task as the moves read and write it. */
export interface TaskNow {
  readonly state: TaskState;
  readonly currentStepId: string | null;
  readonly stepState: TaskStepState | null;
  readonly rounds: TaskRounds;
  readonly escalationReason: string | null;
  readonly escalationTargetStepId: string | null;
}

/** A flow's steps in order (by position). */
export const inOrder = <S extends Pick<FlowStep, 'position'>>(steps: readonly S[]): S[] =>
  [...steps].sort((a, b) => a.position - b.position);

/** How often the task entered a step and how often that step sent it back (none yet: zeros). */
export function roundsAt(rounds: TaskRounds, stepId: string): { entries: number; sendBacks: number } {
  const at = rounds[stepId];
  return { entries: at?.entries ?? 0, sendBacks: at?.sendBacks ?? 0 };
}

/** How a task is named in a path: its id, or its key (`T-12`, any case). */
export type TaskRef = { readonly id: string } | { readonly number: number };

/** A task's id or key as the path gives it; undefined for anything else. */
export function taskRef(value: string): TaskRef | undefined {
  if (isUuid(value)) return { id: value.toLowerCase() };
  const number = taskNumber(value);
  return number === undefined ? undefined : { number };
}

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** The order of a board column's cards: the most urgent first, then the oldest. */
export const boardOrder = (a: Pick<Task, 'priority' | 'number'>, b: Pick<Task, 'priority' | 'number'>) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.number - b.number;
