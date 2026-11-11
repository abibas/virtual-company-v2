import type { DbHandle, Flow, FlowStep, Task, TaskEvent, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import { peopleAtOrAbove } from '@mwc/shared/org-chart';
import { orgOf } from '../../org/index.ts';
import { allowedActions } from '../../tasks/rules/access.ts';
import { roundsAt } from '../../tasks/rules.ts';
import type { InboxRepo } from '../repo.ts';
import { lastMove, taskKind, type Viewer } from '../rules.ts';
import type { InboxCompany, InboxItem, InboxKind } from '../schemas.ts';
import { type Names, namesOf } from './names.ts';

/**
 * The open tasks that need the viewer (S6b, `rules.ts`'s `taskKind`): at their own step, or stuck in a team they lead
 * (the Lead's people, read from the chart as the tasks module's rules do), each with who moved it last, since when, and
 * the moves the tasks API allows the viewer now (`allowedActions`, the task page's own).
 */

interface Found {
  readonly task: Task;
  readonly step: FlowStep;
  readonly kind: InboxKind;
  readonly lead: string;
  readonly leadPeople: readonly string[];
  readonly flowName: string;
}

/** Why it waits: a block's or an escalation's reason, else the reason of the move that brought it (a send-back's). */
function reasonOf(found: Found, move: TaskEvent): string | null {
  if (found.kind === 'blocked') return found.task.blockedReason;
  if (found.kind === 'escalated') return found.task.escalationReason;
  return move.reason;
}

/** Who to name beside it: whoever moved it last, else (a block or a turn's end by itself) the step's assignee. */
function fromOf(found: Found, move: TaskEvent): string {
  return move.actorPrincipalId ?? found.step.assigneePrincipalId;
}

function itemOf(
  found: Found,
  context: {
    readonly company: InboxCompany;
    readonly viewer: Viewer;
    readonly move: TaskEvent;
    readonly names: Names;
  },
): InboxItem {
  const { task, step, kind } = found;
  const { move, names } = context;
  const key = taskKey(task.number);
  const team = { lead: found.lead, leadPeople: found.leadPeople };
  return {
    id: `task:${task.id}`,
    kind,
    company: context.company,
    title: task.title,
    subtitle: `${found.flowName} · ${step.name}`,
    reason: reasonOf(found, move),
    from: names(fromOf(found, move)),
    link: `tasks/${key}`,
    actions: allowedActions(context.viewer, team, task, step),
    task: {
      id: task.id,
      key,
      title: task.title,
      priority: task.priority,
      flow: { id: task.flowId, name: found.flowName, lead: names(found.lead) },
      step: { id: step.id, name: step.name, kind: step.kind },
      round: task.state === 'active' ? roundsAt(task.rounds, step.id).entries : null,
    },
    question: null,
    at: move.createdAt.toISOString(),
  };
}

/** The company's open tasks that need the viewer, as inbox items (unsorted). */
export async function taskItems(
  deps: { readonly db: DbHandle },
  repo: InboxRepo,
  t: TenantDb,
  viewer: Viewer,
  company: InboxCompany,
): Promise<InboxItem[]> {
  const { flows, steps } = await repo.flowsAndSteps(t);
  const mine = steps.filter((step) => step.assigneePrincipalId === viewer.principalId).map((step) => step.id);
  const waiting = await repo.waiting(t, mine);
  if (waiting.length === 0) return [];
  const { chart } = await orgOf(t);
  const byFlow = new Map(flows.map((flow) => [flow.id, flow]));
  const byStep = new Map(steps.map((step) => [step.id, step]));
  const found = waiting.flatMap((task): Found[] => {
    // Every open task has a step but a queued one, which `waiting` leaves out; its flow is its own.
    const flow = byFlow.get(task.flowId) as Flow;
    const step = byStep.get(task.currentStepId as string);
    const leadPeople = peopleAtOrAbove(chart, flow.leadPrincipalId);
    const kind = taskKind(viewer, task, step, leadPeople);
    if (kind === undefined || step === undefined) return [];
    return [{ task, step, kind, lead: flow.leadPrincipalId, leadPeople, flowName: flow.name }];
  });
  if (found.length === 0) return [];
  const moves = await repo.moves(
    t,
    found.map((f) => f.task.id),
  );
  // Every task has its `created` row at least.
  const lastOf = (taskId: string) => lastMove(moves.filter((move) => move.taskId === taskId)) as TaskEvent;
  const names = await namesOf(deps.db, repo, t, [
    ...found.flatMap((f) => [f.lead, f.step.assigneePrincipalId]),
    ...moves.map((move) => move.actorPrincipalId),
  ]);
  return found.map((f) => itemOf(f, { company, viewer, move: lastOf(f.task.id), names }));
}
