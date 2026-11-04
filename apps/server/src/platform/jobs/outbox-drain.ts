import { type DbHandle, type IdentityOutboxRow, identityOutbox } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { IdentityOutboxOp } from '@mwc/shared/enums';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import {
  type OutboxDeps,
  OutboxGiveUpError,
  type OutboxHandler,
  type OutboxHandlers,
  type OutboxOutcome,
  processOutboxRow,
} from './outbox.ts';

/**
 * Draining the identity outbox, for the jobs loop: the due rows (`pending`, `next_attempt_at` reached) are claimed in
 * small batches with a lease, then each runs through `processOutboxRow` with the handler of its op from one registry
 * (`outboxRegistry`, composed in app.ts from the modules' handler maps). Claiming moves `next_attempt_at` to the end
 * of the lease under `for update skip locked`, so a second loop, or the next pass while this one still works, never
 * takes the same row; a row whose try never finished (the process died) is taken again after the lease.
 */

/** Rows one pass claims. */
export const OUTBOX_BATCH = 20;
/** How long a pass owns a row it claimed before another pass may take it again. */
export const OUTBOX_LEASE_MS = 5 * 60_000;

/** One registry of every module's handlers, by op; an op two maps both handle is a wiring mistake and throws. */
export function outboxRegistry(...maps: readonly OutboxHandlers[]): OutboxHandlers {
  const registry: OutboxHandlers = {};
  for (const map of maps) {
    for (const [op, handler] of Object.entries(map) as [IdentityOutboxOp, OutboxHandler][]) {
      if (registry[op] !== undefined) throw new Error(`two outbox handlers for the op ${op}`);
      registry[op] = handler;
    }
  }
  return registry;
}

/** The handler of an op nobody handles: it fails the row at once, since no retry would find a handler. */
const noHandler =
  (op: string): OutboxHandler =>
  async () => {
    throw new OutboxGiveUpError(new Error(`no outbox handler for the op "${op}"`));
  };

/** Enqueue order: the order the local changes made the calls (ids are UUID v7, made in order). */
const enqueued = (a: IdentityOutboxRow, b: IdentityOutboxRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/**
 * Claims up to `limit` due rows, the longest due first, by moving their `next_attempt_at` to `leaseUntil` in one
 * statement under `for update skip locked` (rows another transaction holds are skipped, not waited for), and returns
 * them in enqueue order, so a company's `create_org` runs before the `invite` made after it.
 */
export async function claimDueOutbox(
  db: DbHandle,
  { now, leaseUntil, limit }: { now: Date; leaseUntil: Date; limit: number },
): Promise<IdentityOutboxRow[]> {
  const raw = rawDb(db);
  const due = raw
    .select({ id: identityOutbox.id })
    .from(identityOutbox)
    .where(and(eq(identityOutbox.status, 'pending'), lte(identityOutbox.nextAttemptAt, now)))
    .orderBy(asc(identityOutbox.nextAttemptAt), asc(identityOutbox.createdAt), asc(identityOutbox.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  const rows = await raw
    .update(identityOutbox)
    .set({ nextAttemptAt: leaseUntil })
    .where(inArray(identityOutbox.id, due))
    .returning();
  return rows.sort(enqueued);
}

/** What one pass did: the rows claimed and the outcome of each. */
export type OutboxDrain = { readonly claimed: number } & Readonly<Record<OutboxOutcome, number>>;

/**
 * Claims one batch of due rows and runs each with its op's handler from `handlers` (one with no handler fails at
 * once, with that said in `last_error`). Every outcome is recorded on its row by `processOutboxRow`: done, tried
 * again after the backoff, or failed for good.
 */
export async function drainOutbox(
  deps: OutboxDeps,
  handlers: OutboxHandlers,
  { limit = OUTBOX_BATCH }: { limit?: number } = {},
): Promise<OutboxDrain> {
  const now = deps.clock();
  const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS);
  const rows = await claimDueOutbox(deps.db, { now, leaseUntil, limit });
  const tally = { claimed: rows.length, done: 0, retry: 0, failed: 0, skipped: 0 };
  for (const row of rows) tally[await processOutboxRow(deps, row, handlers[row.op] ?? noHandler(row.op))]++;
  return tally;
}
