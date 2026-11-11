import type { TaskAction, TaskState, TaskStepState } from '@mwc/shared/enums';
import { type Refusal, refuse, type StepRule, type TaskNow } from '../rules.ts';

// Which moves a task has as it stands (docs/processes.md, "Step kinds"): Work hands on, Check passes or sends back,
// Sign-off approves or sends back, a step's moves only while the task is active there, a start only while it waits, and
// the Lead's moves on an open task. Who asks is `rules/access.ts`'s question; what the move makes, `rules/machine.ts`'s.

const STEP_KIND_OF: Readonly<Record<'hand_on' | 'pass' | 'approve', StepRule['kind']>> = {
  hand_on: 'work',
  pass: 'check',
  approve: 'signoff',
};
const OPEN: readonly TaskState[] = ['queued', 'active', 'escalated'];
const STARTABLE: readonly (TaskStepState | null)[] = ['waiting', 'blocked', 'ended_without_handoff'];

const wrongState = (message: string) => refuse(409, 'wrong_state', message);
const wrongKind = (action: TaskAction, step: StepRule) =>
  refuse(422, 'wrong_kind', `${action} is not a move of "${step.name}", a ${step.kind} step`);

/**
 * Whether `action` is a move of the task as it stands, regardless of who asks and of its `toStepId` and reason:
 * refused 409 `wrong_state` (not active for a step's move, not escalated for a retry, already closed, already started)
 * or 422 `wrong_kind` (the step's kind has no such outcome) and `no_send_back_target` (a send-back from a step that
 * names none). `current` is the step the task is at, or escalated from.
 */
export function moveRefusal(
  task: TaskNow,
  current: StepRule | undefined,
  action: TaskAction,
): Refusal<409 | 422> | undefined {
  if (action === 'route' || action === 'cancel') {
    return OPEN.includes(task.state) ? undefined : wrongState(`The task is ${task.state}`);
  }
  if (action === 'retry') {
    return task.state === 'escalated' ? undefined : wrongState('Only an escalated task is retried');
  }
  if (task.state !== 'active' || current === undefined) {
    return wrongState(`The task is ${task.state}, not at a step`);
  }
  if (action === 'start') {
    return STARTABLE.includes(task.stepState)
      ? undefined
      : wrongState(`The task is ${task.stepState} already`);
  }
  if (action === 'send_back') {
    if (current.kind === 'work') return wrongKind(action, current);
    if (current.sendsBackToStepId === null) {
      return refuse(422, 'no_send_back_target', `"${current.name}" names no step to send a task back to`);
    }
    return undefined;
  }
  return current.kind === STEP_KIND_OF[action] ? undefined : wrongKind(action, current);
}
