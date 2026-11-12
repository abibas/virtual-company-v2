import type { DbHandle, Flow, LeadWakeEvent, Task, TenantDb } from '@mwc/db';
import { type LeadWakeItem, leadWakeMessage, taskKey } from '@mwc/shared/flows';
import { principalNames } from '../../../org/index.ts';
import type { TasksRepo } from '../../repo.ts';
import { hoursSince } from '../../rules/wake.ts';
import type { Roster } from '../team.ts';

/**
 * A wake-up's message (S6c): the flow's events as `leadWakeMessage` of `@mwc/shared/flows` writes them, each with its
 * task's key and title as they are now, the step and the reason it was written with; a sign-off's wait names whom it
 * waits for and how long; the Lead may ask its nearest person, named.
 */
export async function wakeMessage(
  deps: { readonly db: DbHandle },
  repo: TasksRepo,
  t: TenantDb,
  of: {
    readonly flow: Flow;
    readonly roster: Roster;
    readonly events: readonly LeadWakeEvent[];
    readonly tasks: ReadonlyMap<string, Task>;
    readonly now: Date;
  },
): Promise<string> {
  const { flow, events, tasks, now } = of;
  const person = of.roster.leadPerson(flow.leadPrincipalId);
  const steps = new Map((await repo.flows.steps(t, flow.id)).map((step) => [step.id, step]));
  const assignee = (task: Task) =>
    task.currentStepId === null ? undefined : steps.get(task.currentStepId)?.assigneePrincipalId;
  const names = await principalNames(deps.db, t, [person, ...[...tasks.values()].map(assignee)]);
  const items = events.flatMap((event): LeadWakeItem[] => {
    const task = tasks.get(event.taskId);
    if (task === undefined) return [];
    const who = assignee(task);
    const waiting =
      event.kind === 'signoff_waiting' && who !== undefined
        ? { who: names(who).name, hours: hoursSince(task.updatedAt, now) }
        : undefined;
    return [
      {
        kind: event.kind,
        task: { key: taskKey(task.number), title: task.title },
        step: event.stepName,
        reason: event.reason,
        waiting,
      },
    ];
  });
  return leadWakeMessage({
    flow: flow.name,
    person: person === null ? null : names(person).name,
    events: items,
  });
}
