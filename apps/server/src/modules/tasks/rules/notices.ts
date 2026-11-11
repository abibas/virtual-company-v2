import type { Notice } from '../../notifications/rules.ts';
import type { StepRule } from '../rules.ts';

// Whom a task's move tells (docs/notifications.md, "Tasks"): the person a task came to (their step, or their
// sign-off), the nearest person at or above the Lead when it is escalated, and its creator and that person when it is
// done. The notifications module leaves out the actor and agents (agents get tools in S6, not notices).

/** A move as its notices read it. */
export interface MoveNoticeInput {
  readonly taskId: string;
  /** The flow's Lead: whom the task's notices are about. */
  readonly lead: string;
  /** The nearest person at or above the Lead on the chart (the Lead itself when a person); null for none. */
  readonly leadPerson: string | null;
  readonly creator: string;
  /** The step the task entered, if any. */
  readonly entered: StepRule | null;
  readonly outcome: 'started' | 'moved' | 'done' | 'escalated' | 'cancelled' | 'created';
  /** The step it was at before the move (an escalation names it). */
  readonly from: StepRule | undefined;
}

/** A move's notices, before the notifications module filters them. */
export function moveNotices(input: MoveNoticeInput): Notice[] {
  const about = { about: input.lead, task: input.taskId };
  const notices: Notice[] = [];
  if (input.entered !== null) {
    const kind = input.entered.kind === 'signoff' ? 'task_signoff' : 'task_at_step';
    const payload = { ...about, step: input.entered.name };
    notices.push({ kind, recipient: input.entered.assigneePrincipalId, payload });
  }
  if (input.outcome === 'escalated' && input.leadPerson !== null) {
    const payload = input.from ? { ...about, step: input.from.name } : about;
    notices.push({ kind: 'task_escalated', recipient: input.leadPerson, payload });
  }
  if (input.outcome === 'done') {
    notices.push({ kind: 'task_done', recipient: input.creator, payload: about });
    if (input.leadPerson !== null)
      notices.push({ kind: 'task_done', recipient: input.leadPerson, payload: about });
  }
  return notices;
}
