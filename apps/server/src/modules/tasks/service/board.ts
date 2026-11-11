import type { DbHandle, Flow, Task, TenantDb } from '@mwc/db';
import { BOARD_DONE } from '@mwc/shared/flows';
import type { TasksRepo } from '../repo.ts';
import { boardOrder, inOrder } from '../rules.ts';
import type { BoardColumnView, BoardView } from '../schemas/board.ts';
import { namesOf } from './team.ts';
import { boardCard, holderOf } from './views.ts';

/**
 * A flow's board (`GET …/flows/{flowId}/board`, docs/processes.md): Queued, then a column per step in order, then Done
 * (the latest `done` closed, with the count of all) and Escalated. Each open column lists its cards the most urgent
 * first, then the oldest; a cancelled task is on no column.
 */
export async function boardOf(
  deps: { readonly db: DbHandle },
  repo: TasksRepo,
  t: TenantDb,
  flow: Flow,
  done: number = BOARD_DONE.default,
): Promise<BoardView> {
  const steps = inOrder(await repo.flows.steps(t, flow.id));
  const open = (await repo.tasks.open(t, flow.id)).sort(boardOrder);
  const latest = await repo.tasks.latestDone(t, flow.id, done);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const holders = open.map((task) =>
    holderOf(
      task,
      task.currentStepId === null ? undefined : byId.get(task.currentStepId),
      flow.leadPrincipalId,
    ),
  );
  const names = await namesOf(deps.db, repo, t, [
    flow.leadPrincipalId,
    ...steps.map((step) => step.assigneePrincipalId),
    ...holders,
  ]);
  const card = (task: Task) => boardCard(task, byId, flow.leadPrincipalId, names);
  const column = (
    kind: BoardColumnView['kind'],
    title: string,
    tasks: readonly Task[],
    step: BoardColumnView['step'] = null,
    total = tasks.length,
  ): BoardColumnView => ({ kind, title, step, cards: tasks.map(card), total });
  const at = (stepId: string) =>
    open.filter((task) => task.state === 'active' && task.currentStepId === stepId);
  return {
    flow: { id: flow.id, name: flow.name, lead: names(flow.leadPrincipalId) },
    columns: [
      column(
        'queued',
        'Queued',
        open.filter((task) => task.state === 'queued'),
      ),
      ...steps.map((step) =>
        column('step', step.name, at(step.id), {
          id: step.id,
          kind: step.kind,
          assignee: names(step.assigneePrincipalId),
        }),
      ),
      column('done', 'Done', latest, null, await repo.tasks.doneCount(t, flow.id)),
      column(
        'escalated',
        'Escalated',
        open.filter((task) => task.state === 'escalated'),
      ),
    ],
  };
}
