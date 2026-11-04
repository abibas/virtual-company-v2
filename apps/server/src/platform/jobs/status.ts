import { type DbHandle, identityOutbox } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';

/** What `/readyz` shows about the jobs loop of this process (none of it makes the server not ready). */
export interface JobsStatus {
  /** MWC_JOBS: this process runs the jobs loop at all. */
  readonly enabled: boolean;
  /** This process holds the jobs lock, so it is the one running the jobs on this database. */
  readonly holdsLock: boolean;
  /** When this process last finished a tick of the jobs; null before its first. */
  readonly lastTickAt: Date | null;
}

/** The jobs loop as the app sees it: its status, read on every `/readyz`. */
export interface JobsView {
  status(): JobsStatus;
}

/** The view of a process whose jobs loop is off (MWC_JOBS=off, and every test app unless it passes one). */
export const JOBS_OFF: JobsView = { status: () => ({ enabled: false, holdsLock: false, lastTickAt: null }) };

/** The identity outbox's backlog: rows due now, and rows given up for good. */
export interface OutboxBacklog {
  readonly due: number;
  readonly failed: number;
}

/** Counts the outbox rows that are due at `now` (pending, their time reached) and the ones failed for good. */
export async function outboxBacklog(db: DbHandle, now: Date): Promise<OutboxBacklog> {
  const due = and(eq(identityOutbox.status, 'pending'), lte(identityOutbox.nextAttemptAt, now));
  // An aggregate without `group by` is always one row.
  const [row] = (await rawDb(db)
    .select({
      due: sql<number>`count(*) filter (where ${due})::int`,
      failed: sql<number>`count(*) filter (where ${eq(identityOutbox.status, 'failed')})::int`,
    })
    .from(identityOutbox)
    .where(inArray(identityOutbox.status, ['pending', 'failed']))) as [OutboxBacklog];
  return { due: row.due, failed: row.failed };
}
