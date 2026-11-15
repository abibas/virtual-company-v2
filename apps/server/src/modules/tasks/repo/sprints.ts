import {
  type Flow,
  isUuid,
  type Sprint,
  sprints,
  type Task,
  type TenantDb,
  type TenantSet,
  type TenantValues,
  tasks,
} from '@mwc/db';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

/** A flow's sprints and their tasks (T-37), through the company's tenant only. */

/** The flow's current sprint (the one not ended); `lock` holds its row until the transaction ends. */
async function current(t: TenantDb, flowId: string, lock = false): Promise<Sprint | undefined> {
  const query = t.select(sprints, and(eq(sprints.flowId, flowId), isNull(sprints.endedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/**
 * The flow's current sprint, made when it has none yet (a flow made before its Sprint 1 was: its Sprint 1, started when
 * the flow was made, by whoever made it). `lock` holds its row until the transaction ends.
 */
async function ensure(
  t: TenantDb,
  flow: Pick<Flow, 'id' | 'createdAt' | 'createdBy'>,
  lock = false,
): Promise<Sprint> {
  const found = await current(t, flow.id, lock);
  if (found !== undefined) return found;
  const first = { flowId: flow.id, number: 1, name: 'Sprint 1', startedAt: flow.createdAt, startedBy: flow.createdBy };
  await t.insert(sprints, first).onConflictDoNothing();
  return (await current(t, flow.id, lock)) as Sprint;
}

/** The flow's sprints, the newest first. */
const list = (t: TenantDb, flowId: string): Promise<Sprint[]> =>
  t.select(sprints, eq(sprints.flowId, flowId)).orderBy(desc(sprints.number));

/** One of the flow's sprints by id; undefined for an unknown, malformed or another flow's id. */
async function get(t: TenantDb, flowId: string, id: string): Promise<Sprint | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(sprints, and(eq(sprints.flowId, flowId), eq(sprints.id, id)));
  return row;
}

async function insert(t: TenantDb, values: TenantValues<typeof sprints>): Promise<Sprint> {
  const [row] = (await t.insert(sprints, values).returning()) as [Sprint];
  return row;
}

async function update(t: TenantDb, id: string, set: TenantSet<typeof sprints>): Promise<Sprint> {
  const [row] = (await t.update(sprints, set, eq(sprints.id, id)).returning()) as [Sprint];
  return row;
}

/** The sprint's closed tasks (done or cancelled), the latest closed first. */
const closed = (t: TenantDb, sprintId: string): Promise<Task[]> =>
  t
    .select(tasks, and(eq(tasks.sprintId, sprintId), inArray(tasks.state, ['done', 'cancelled'])))
    .orderBy(desc(tasks.closedAt), desc(tasks.number));

/** How many of the sprint's tasks are done and how many cancelled. */
async function closedCounts(t: TenantDb, sprintId: string): Promise<{ done: number; cancelled: number }> {
  const rows = await t
    .selectFields(
      tasks,
      { state: tasks.state, n: count() },
      and(eq(tasks.sprintId, sprintId), inArray(tasks.state, ['done', 'cancelled'])),
    )
    .groupBy(tasks.state);
  const of = (state: string) => rows.find((row) => row.state === state)?.n ?? 0;
  return { done: of('done'), cancelled: of('cancelled') };
}

/** How many of the flow's tasks were made from `from` until `until` (now while the sprint runs). */
async function createdBetween(t: TenantDb, flowId: string, from: Date, until: Date | null): Promise<number> {
  const where = and(
    eq(tasks.flowId, flowId),
    gte(tasks.createdAt, from),
    until === null ? undefined : lt(tasks.createdAt, until),
  );
  const [row] = await t.selectFields(tasks, { n: count() }, where);
  return row?.n ?? 0;
}

/** Puts every open task of the flow (queued, active, escalated) into `sprintId`; their last change stays as it was. */
async function carryOver(t: TenantDb, flowId: string, sprintId: string): Promise<void> {
  await t.update(
    tasks,
    { sprintId, updatedAt: sql`${tasks.updatedAt}` as never },
    and(eq(tasks.flowId, flowId), inArray(tasks.state, ['queued', 'active', 'escalated'])),
  );
}

/** The flow's open tasks, oldest first (what a sprint carries over). */
const open = (t: TenantDb, flowId: string): Promise<Task[]> =>
  t
    .select(tasks, and(eq(tasks.flowId, flowId), inArray(tasks.state, ['queued', 'active', 'escalated'])))
    .orderBy(asc(tasks.number));

export const sprintRows = {
  current,
  ensure,
  list,
  get,
  insert,
  update,
  closed,
  closedCounts,
  createdBetween,
  carryOver,
  open,
};
