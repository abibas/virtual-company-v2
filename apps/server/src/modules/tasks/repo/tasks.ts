import {
  isUuid,
  type Task,
  type TaskEvent,
  type TenantDb,
  type TenantSet,
  type TenantValues,
  taskEvents,
  tasks,
} from '@mwc/db';
import type { TaskState } from '@mwc/shared/enums';
import { and, asc, count, desc, eq, ilike, inArray, lt, max, or, type SQL, sql } from 'drizzle-orm';
import { likeLiteral, type TaskCursor, type TaskSearch } from '../rules/list.ts';
import type { TaskRef } from '../rules.ts';

/** The tasks and their history, through the company's tenant only (S5.3a). */

/** One task by id or number; undefined for an unknown or another company's one. */
async function get(t: TenantDb, ref: TaskRef): Promise<Task | undefined> {
  if ('id' in ref && !isUuid(ref.id)) return undefined;
  const where = 'id' in ref ? eq(tasks.id, ref.id) : eq(tasks.number, ref.number);
  const [row] = await t.select(tasks, where);
  return row;
}

/** The task's row, locked until the transaction ends (after its flow's: the order every move takes). */
async function lock(t: TenantDb, id: string): Promise<Task> {
  const [row] = (await t.select(tasks, eq(tasks.id, id)).for('update')) as [Task];
  return row;
}

/** The next task number of the company (under the company's lock: one at a time). */
async function nextNumber(t: TenantDb): Promise<number> {
  const [row] = await t.selectFields(tasks, { last: max(tasks.number) });
  return (row?.last ?? 0) + 1;
}

async function insert(t: TenantDb, values: TenantValues<typeof tasks>): Promise<Task> {
  const [row] = (await t.insert(tasks, values).returning()) as [Task];
  return row;
}

async function update(t: TenantDb, id: string, set: TenantSet<typeof tasks>): Promise<Task> {
  const [row] = (await t.update(tasks, set, eq(tasks.id, id)).returning()) as [Task];
  return row;
}

/** What the task list is filtered by; `assignee` is the steps of theirs and the flows they lead. */
export interface TaskFilter {
  readonly flowId?: string | undefined;
  readonly states?: readonly TaskState[] | undefined;
  readonly stepId?: string | undefined;
  readonly assignee?:
    | { readonly stepIds: readonly string[]; readonly flowIds: readonly string[] }
    | undefined;
  /** Only tasks numbered below this (the page after one ending there). */
  readonly before?: number | undefined;
  /** Its number, or a part of its title. */
  readonly search?: TaskSearch | undefined;
  /** `updated`: the latest change first; else the newest task first. */
  readonly sort?: 'created' | 'updated' | undefined;
  /** Only tasks after this one in the order (the page after one ending there). */
  readonly after?: TaskCursor | undefined;
}

/** A task's last change to the millisecond, as a page's cursor holds it. */
const changed = sql`date_trunc('milliseconds', ${tasks.updatedAt})`;

/** The tasks after `cursor` in the order: by number, or by the last change and then the number. */
function afterWhere(sort: TaskFilter['sort'], cursor: TaskCursor | undefined): SQL | undefined {
  if (cursor === undefined) return undefined;
  if (sort !== 'updated') return lt(tasks.number, cursor.number);
  return sql`(${changed}, ${tasks.number}) < (${cursor.updatedAt.toISOString()}::timestamptz, ${cursor.number})`;
}

function searchWhere(search: TaskSearch | undefined): SQL | undefined {
  if (search === undefined) return undefined;
  const title = ilike(tasks.title, `%${likeLiteral(search.title)}%`);
  return search.number === undefined ? title : or(eq(tasks.number, search.number), title);
}

/** `column in (ids)`, or false for no ids. */
const anyOf = (column: typeof tasks.currentStepId | typeof tasks.flowId, ids: readonly string[]): SQL =>
  ids.length === 0 ? sql`false` : (inArray(column, [...ids]) as SQL);

function filterWhere(filter: TaskFilter): SQL | undefined {
  const { flowId, states, stepId, assignee, before, search, sort, after } = filter;
  const assigned =
    assignee &&
    or(
      and(eq(tasks.state, 'active'), anyOf(tasks.currentStepId, assignee.stepIds)),
      and(eq(tasks.state, 'escalated'), anyOf(tasks.flowId, assignee.flowIds)),
    );
  return and(
    flowId === undefined ? undefined : eq(tasks.flowId, flowId),
    states === undefined ? undefined : inArray(tasks.state, [...states]),
    stepId === undefined ? undefined : eq(tasks.currentStepId, stepId),
    assigned,
    before === undefined ? undefined : lt(tasks.number, before),
    searchWhere(search),
    afterWhere(sort, after),
  );
}

/** A page of the company's tasks, newest first, or the latest change first. */
const page = (t: TenantDb, filter: TaskFilter, limit: number): Promise<Task[]> => {
  const query = t.select(tasks, filterWhere(filter));
  const ordered =
    filter.sort === 'updated'
      ? query.orderBy(desc(changed), desc(tasks.number))
      : query.orderBy(desc(tasks.number));
  return ordered.limit(limit);
};

/** The flow's open tasks: queued, active and escalated. */
const open = (t: TenantDb, flowId: string): Promise<Task[]> =>
  t
    .select(tasks, and(eq(tasks.flowId, flowId), inArray(tasks.state, ['queued', 'active', 'escalated'])))
    .orderBy(asc(tasks.number));

/** The flow's latest done tasks, the latest closed first. */
const latestDone = (t: TenantDb, flowId: string, limit: number): Promise<Task[]> =>
  t
    .select(tasks, and(eq(tasks.flowId, flowId), eq(tasks.state, 'done')))
    .orderBy(desc(tasks.closedAt), desc(tasks.number))
    .limit(limit);

/** How many of the flow's tasks are done. */
async function doneCount(t: TenantDb, flowId: string): Promise<number> {
  const [row] = await t.selectFields(
    tasks,
    { n: count() },
    and(eq(tasks.flowId, flowId), eq(tasks.state, 'done')),
  );
  return row?.n ?? 0;
}

/** How many open tasks (queued, active, escalated) each flow has, by flow id. */
async function openByFlow(t: TenantDb): Promise<Map<string, number>> {
  const rows = await t
    .selectFields(
      tasks,
      { flowId: tasks.flowId, n: count() },
      inArray(tasks.state, ['queued', 'active', 'escalated']),
    )
    .groupBy(tasks.flowId);
  return new Map(rows.map((row) => [row.flowId, row.n]));
}

async function insertEvents(t: TenantDb, rows: readonly TenantValues<typeof taskEvents>[]): Promise<void> {
  if (rows.length > 0) await t.insert(taskEvents, rows);
}

/** A task's history, oldest first. */
const events = (t: TenantDb, taskId: string): Promise<TaskEvent[]> =>
  t.select(taskEvents, eq(taskEvents.taskId, taskId)).orderBy(asc(taskEvents.id));

export const taskRows = {
  get,
  lock,
  nextNumber,
  insert,
  update,
  page,
  open,
  latestDone,
  doneCount,
  openByFlow,
  insertEvents,
  events,
};
