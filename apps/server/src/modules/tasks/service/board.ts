import type { DbHandle, Flow, Task, TenantDb } from '@mwc/db';
import { BOARD_DONE } from '@mwc/shared/flows';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { boardOrder, inOrder, queueOrder } from '../rules.ts';
import type { BoardColumnView, BoardView } from '../schemas/board.ts';
import { boardCard, holderOf } from './views.ts';

/**
 * A flow's board (`GET …/flows/{flowId}/board`, docs/processes.md): its current sprint (T-37), Queued, then a column
 * per step in order, then Done (the current sprint's latest closed, done or cancelled, with the count of all; a
 * cancelled card says so) and Escalated. Each open
 * column lists its cards the most urgent first, then the oldest; Queued the most urgent first, then by its place in
 * the queue, each card with the tasks it waits for (T-39). An open card says when its agent Lead was told of it
 * as it stands (S6c, `leadNotifiedAt`).
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
  const sprint = await repo.sprints.ensure(t, flow);
  const latest = await repo.tasks.latestDone(t, sprint.id, done);
  const closed = await repo.sprints.closedCounts(t, sprint.id);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const holders = open.map((task) =>
    holderOf(
      task,
      task.currentStepId === null ? undefined : byId.get(task.currentStepId),
      flow.leadPrincipalId,
    ),
  );
  const names = await principalNames(deps.db, t, [
    flow.leadPrincipalId,
    sprint.startedBy,
    ...steps.map((step) => step.assigneePrincipalId),
    ...holders,
  ]);
  const counts = await repo.artifacts.counts(
    t,
    [...open, ...latest].map((task) => task.id),
  );
  const told = await repo.wakes.toldOf(
    t,
    open.map((task) => task.id),
  );
  const waits = await repo.waits.of(
    t,
    open.map((task) => task.id),
  );
  const card = (task: Task) =>
    boardCard(
      task,
      byId,
      flow.leadPrincipalId,
      names,
      counts.get(task.id) ?? 0,
      told.get(task.id) ?? null,
      waits.get(task.id) ?? [],
    );
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
    flow: {
      id: flow.id,
      name: flow.name,
      lead: names(flow.leadPrincipalId),
      newTaskStepId: flow.newTaskStepId,
      newTaskAutoTake: flow.newTaskAutoTake,
    },
    sprint: {
      id: sprint.id,
      number: sprint.number,
      name: sprint.name,
      startedAt: sprint.startedAt.toISOString(),
      startedBy: names(sprint.startedBy),
      done: closed.done,
      cancelled: closed.cancelled,
    },
    columns: [
      column('queued', 'Queued', open.filter((task) => task.state === 'queued').sort(queueOrder)),
      ...steps.map((step) =>
        column('step', step.name, at(step.id), {
          id: step.id,
          kind: step.kind,
          assignee: names(step.assigneePrincipalId),
        }),
      ),
      column('done', 'Done', latest, null, closed.done + closed.cancelled),
      column(
        'escalated',
        'Escalated',
        open.filter((task) => task.state === 'escalated'),
      ),
    ],
  };
}
