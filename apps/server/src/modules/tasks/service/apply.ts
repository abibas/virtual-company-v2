import type { Flow, Task, TenantDb } from '@mwc/db';
import { notify } from '../../notifications/service.ts';
import type { TasksRepo } from '../repo.ts';
import type { EventDraft, Transition } from '../rules/machine.ts';
import { moveNotices } from '../rules/notices.ts';
import type { StepRule } from '../rules.ts';
import { audit, type Caller } from './audit.ts';
import type { Roster } from './team.ts';

/** A history row of a task, by `caller` unless it happened by itself. */
export function eventRow(taskId: string, caller: Caller, event: EventDraft) {
  return {
    taskId,
    kind: event.kind,
    actorPrincipalId: event.system ? null : caller.principalId,
    fromStepId: event.from?.id ?? null,
    fromStepName: event.from?.name ?? null,
    toStepId: event.to?.id ?? null,
    toStepName: event.to?.name ?? null,
    round: event.round ?? null,
    reason: event.reason ?? null,
    details: { ...event.details },
  };
}

/**
 * Writes a move the rules made (`move`) in the caller's transaction, under the flow's and the task's locks: the task's
 * new state, its history rows, the audit rows of what changed, and the notices to the people it concerns (the person
 * it came to, the Lead's nearest person on an escalation, its creator and that person when done).
 */
export async function applyMove(
  repo: TasksRepo,
  tx: TenantDb,
  caller: Caller,
  move: {
    readonly task: Task;
    readonly flow: Flow;
    readonly from: StepRule | undefined;
    readonly roster: Roster;
    readonly transition: Transition;
    readonly action: string;
    readonly now: Date;
  },
): Promise<Task> {
  const { task, flow, transition } = move;
  const next = transition.task;
  const closes = next.state === 'done' || next.state === 'cancelled';
  const after = await repo.tasks.update(tx, task.id, {
    state: next.state,
    currentStepId: next.currentStepId,
    stepState: next.stepState,
    rounds: next.rounds,
    escalationReason: next.escalationReason,
    escalationTargetStepId: next.escalationTargetStepId,
    closedAt: closes ? move.now : null,
  });
  await repo.tasks.insertEvents(
    tx,
    transition.events.map((event) => eventRow(task.id, caller, event)),
  );
  await audit(repo, tx, caller, {
    entityType: 'task',
    entityId: task.id,
    action: move.action,
    before: task,
    after,
  });
  const notices = moveNotices({
    taskId: task.id,
    lead: flow.leadPrincipalId,
    leadPerson: move.roster.leadPerson(flow.leadPrincipalId),
    creator: task.createdBy,
    entered: transition.entered,
    outcome: transition.outcome,
    from: move.from,
  });
  await notify(tx, caller.principalId, notices);
  return after;
}
