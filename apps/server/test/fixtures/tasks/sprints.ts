/**
 * The sprints' tests helpers (T-37): a flow's sprints through the API as one of the team, its sprints and a task's
 * sprint as stored, and the flow's times put back to fixed instants. A sprint counts the tasks made while it ran, and
 * the database stamps a new task and a new flow with its own clock while the app's clock stands still at `TEST_NOW`:
 * `backdate` puts the current sprint's start and the tasks made so far before it.
 */
import { type DbHandle, sprints, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { SprintSummaryView, SprintView } from '../../../src/modules/tasks/schemas/sprints.ts';
import { as, type MembersCompany } from '../members/members.ts';
import type { AuthWorld, Person } from '../platform/auth.ts';
import { flowsPath } from '../tasks.ts';

export type { SprintSummaryView, SprintView };

/** `…/flows/{flowId}/sprints`, and what follows it. */
export const sprintsPath = (c: Pick<MembersCompany, 'companyId'>, flowId: string, rest = '') =>
  flowsPath(c, `/${flowId}/sprints${rest}`);

/** The flow's sprints as `by` reads them, the newest first; the test fails on anything but a 200. */
export async function sprintList(
  w: AuthWorld,
  c: Pick<MembersCompany, 'companyId'>,
  by: Person,
  flowId: string,
): Promise<SprintSummaryView[]> {
  const res = await as(w, by)('GET', sprintsPath(c, flowId));
  if (res.status !== 200) throw new Error(`GET sprints answered ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as { sprints: SprintSummaryView[] }).sprints;
}

/** One sprint with its report as `by` reads it; the test fails on anything but a 200. */
export async function sprintOf(
  w: AuthWorld,
  c: Pick<MembersCompany, 'companyId'>,
  by: Person,
  ref: { readonly flowId: string; readonly sprintId: string },
): Promise<SprintView> {
  const res = await as(w, by)('GET', sprintsPath(c, ref.flowId, `/${ref.sprintId}`));
  if (res.status !== 200) throw new Error(`GET sprint answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as SprintView;
}

/** Starts the flow's next sprint as `by`; the test fails on anything but a 201. */
export async function startSprint(
  w: AuthWorld,
  c: Pick<MembersCompany, 'companyId'>,
  by: Person,
  flowId: string,
  body: Record<string, unknown> = {},
): Promise<SprintView> {
  const res = await as(w, by)('POST', sprintsPath(c, flowId), body);
  if (res.status !== 201) throw new Error(`POST sprints answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as SprintView;
}

/** The flow's sprints as stored, the oldest first. */
export const sprintRows = (db: DbHandle, flowId: string) =>
  rawDb(db).select().from(sprints).where(eq(sprints.flowId, flowId)).orderBy(asc(sprints.number));

/** The sprint a task is in, as stored. */
export const sprintIdOf = async (db: DbHandle, taskId: string) =>
  (await rawDb(db).select({ sprintId: tasks.sprintId }).from(tasks).where(eq(tasks.id, taskId)))[0]?.sprintId;

/** The flow's current sprint started at `started`, and every task of the flow so far made at `created`. */
export async function backdate(
  db: DbHandle,
  flowId: string,
  at: { readonly started: Date; readonly created: Date },
): Promise<void> {
  const current = and(eq(sprints.flowId, flowId), isNull(sprints.endedAt));
  await rawDb(db).update(sprints).set({ startedAt: at.started }).where(current);
  await rawDb(db).update(tasks).set({ createdAt: at.created }).where(eq(tasks.flowId, flowId));
}

/** A task made at `at`, as stored. */
export async function madeAt(db: DbHandle, taskId: string, at: Date): Promise<void> {
  await rawDb(db).update(tasks).set({ createdAt: at }).where(eq(tasks.id, taskId));
}
