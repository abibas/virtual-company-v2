/**
 * The queue's tests helpers (T-25 Autotake, T-34 per task, T-38 new tasks' defaults, T-39 order and "waits for"): a
 * flow's and a task's PATCH as one of the team, the flow's Autotake turned on, a task as its page shows it, the keys of
 * the flow's tasks in a state, and of the board's Queued column in its order, and the flow's tasks' states as stored.
 */
import { type DbHandle, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { asc, eq } from 'drizzle-orm';
import type { BoardView } from '../../../src/modules/tasks/schemas/board.ts';
import type { FlowView } from '../../../src/modules/tasks/schemas/flows.ts';
import { as } from '../members/members.ts';
import type { AuthWorld, Person } from '../platform/auth.ts';
import { flowsPath, type TaskDetailView, type TeamCompany, tasksPath } from '../tasks.ts';

/** The error code of a refusal; undefined for an answer that is not one. */
export const errorCode = (res: { body: unknown }) => (res.body as { error?: { code: string } }).error?.code;

/** The flow's PATCH as `by`: the response as the API answers it. */
export const patchFlow = (
  w: AuthWorld,
  c: TeamCompany,
  by: Person,
  flowId: string,
  body: Record<string, unknown>,
) => as(w, by)('PATCH', flowsPath(c, `/${flowId}`), body);

/** The task's PATCH as `by`: the response as the API answers it. */
export const patchTask = (
  w: AuthWorld,
  c: TeamCompany,
  by: Person,
  key: string,
  body: Record<string, unknown>,
) => as(w, by)('PATCH', tasksPath(c, `/${key}`), body);

/** The task's PATCH as `by` that must succeed: the task after it. */
export async function edited(
  w: AuthWorld,
  c: TeamCompany,
  by: Person,
  key: string,
  body: Record<string, unknown>,
): Promise<TaskDetailView> {
  const res = await patchTask(w, c, by, key, body);
  if (res.status !== 200) throw new Error(`PATCH ${key} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as TaskDetailView;
}

/** The flow's PATCH as the owner that must succeed: the flow after it. */
export async function flowPatched(
  w: AuthWorld,
  c: TeamCompany,
  flowId: string,
  body: Record<string, unknown>,
): Promise<FlowView> {
  const res = await patchFlow(w, c, c.owner, flowId, body);
  if (res.status !== 200) throw new Error(`PATCH flow answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as FlowView;
}

/** Turns the flow's Autotake on with this in-progress limit (2 unless said), as the owner. */
export const autoTakeOn = (w: AuthWorld, c: TeamCompany, flowId: string, inProgressLimit = 2) =>
  flowPatched(w, c, flowId, { autoTake: true, inProgressLimit });

/** The task as its page shows it to the viewer. */
export async function shown(w: AuthWorld, c: TeamCompany, key: string): Promise<TaskDetailView> {
  const res = await as(w, c.viewer)('GET', tasksPath(c, `/${key}`));
  if (res.status !== 200) throw new Error(`GET ${key} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as TaskDetailView;
}

/** The keys of the flow's tasks in this state (several with commas), the newest first. */
export async function keysIn(w: AuthWorld, c: TeamCompany, flowId: string, state: string): Promise<string[]> {
  const res = await as(w, c.viewer)('GET', tasksPath(c, `?flowId=${flowId}&state=${state}`));
  return (res.body as { tasks: { key: string }[] }).tasks.map((task) => task.key);
}

/** The flow's board as the viewer sees it. */
export async function boardOf(w: AuthWorld, c: TeamCompany, flowId: string): Promise<BoardView> {
  const res = await as(w, c.viewer)('GET', flowsPath(c, `/${flowId}/board`));
  if (res.status !== 200) throw new Error(`GET board answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as BoardView;
}

/** The keys of the board's Queued column, in its order. */
export const queuedKeys = async (w: AuthWorld, c: TeamCompany, flowId: string) =>
  ((await boardOf(w, c, flowId)).columns[0]?.cards ?? []).map((card) => card.key);

/** The flow's tasks as stored, by number: `[key, state]` (for a company the API no longer answers for). */
export async function storedStates(db: DbHandle, flowId: string) {
  const rows = await rawDb(db)
    .select()
    .from(tasks)
    .where(eq(tasks.flowId, flowId))
    .orderBy(asc(tasks.number));
  return rows.map((row) => [`T-${row.number}`, row.state] as const);
}
