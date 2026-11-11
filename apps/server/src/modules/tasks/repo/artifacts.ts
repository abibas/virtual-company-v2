import { isUuid, type TaskArtifact, type TenantDb, type TenantValues, taskArtifacts } from '@mwc/db';
import { HANDOFF_NOTE } from '@mwc/shared/flows';
import { and, asc, count, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';

/**
 * A task's artifacts, through the company's tenant only (S5.3b): one row per task, step, round and name, so a file
 * collected again in the same round replaces the one before; lists without the bytes, one with them for a download.
 */

/** An artifact without its bytes, as lists show it. */
export type ArtifactRow = Omit<TaskArtifact, 'bytes'>;

const { bytes: _bytes, ...listed } = getTableColumns(taskArtifacts);

/** Writes an artifact, or replaces the one of the same task, step, round and name. */
async function upsert(t: TenantDb, values: TenantValues<typeof taskArtifacts>): Promise<void> {
  const { taskId: _task, stepId: _step, round: _round, name: _name, ...change } = values;
  await t.insert(taskArtifacts, values).onConflictDoUpdate({
    target: [
      taskArtifacts.companyId,
      taskArtifacts.taskId,
      taskArtifacts.stepId,
      taskArtifacts.round,
      taskArtifacts.name,
    ],
    set: { ...change, updatedAt: sql`now()` },
  });
}

/** The task's artifacts without their bytes, oldest first. */
const ofTask = (t: TenantDb, taskId: string): Promise<ArtifactRow[]> =>
  t.selectFields(taskArtifacts, listed, eq(taskArtifacts.taskId, taskId)).orderBy(asc(taskArtifacts.id));

/** One artifact of the task with its bytes; undefined for an unknown, malformed or another task's id. */
async function get(t: TenantDb, taskId: string, id: string): Promise<TaskArtifact | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(
    taskArtifacts,
    and(eq(taskArtifacts.taskId, taskId), eq(taskArtifacts.id, id)),
  );
  return row;
}

/** How many artifacts each task has, skipped files left out. */
async function counts(t: TenantDb, taskIds: readonly string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const where = and(inArray(taskArtifacts.taskId, [...taskIds]), ne(taskArtifacts.kind, 'skipped'));
  const rows = await t
    .selectFields(taskArtifacts, { taskId: taskArtifacts.taskId, n: count() }, where)
    .groupBy(taskArtifacts.taskId);
  return new Map(rows.map((row) => [row.taskId, row.n]));
}

/** The step's latest hand-off note (its last round's final reply), as text; undefined for none. */
async function lastNote(t: TenantDb, taskId: string, stepId: string): Promise<string | undefined> {
  const where = and(
    eq(taskArtifacts.taskId, taskId),
    eq(taskArtifacts.stepId, stepId),
    eq(taskArtifacts.name, HANDOFF_NOTE),
    eq(taskArtifacts.kind, 'note'),
  );
  const [row] = await t
    .selectFields(taskArtifacts, { bytes: taskArtifacts.bytes }, where)
    .orderBy(desc(taskArtifacts.round))
    .limit(1);
  return row?.bytes ? new TextDecoder().decode(row.bytes) : undefined;
}

export const artifactRows = { upsert, ofTask, get, counts, lastNote };
