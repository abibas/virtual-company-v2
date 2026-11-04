import { type IdentityEventRow, identityEvents } from '@mwc/db';
import { type DbHandle, rawDb } from '@mwc/db/system';
import type { IdentityInboxEvent } from '@mwc/shared/identity';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';

/**
 * The webhook inbox (`identity_events`): one row per verified delivery, deduplicated on `(provider,
 * external_event_id)`. Due rows are claimed with a lease (`next_attempt_at` pushed ahead under `for update skip
 * locked`), so two loops, or a loop and an inline try, never work on the same row at once. The identity module's
 * repo is the one place in `modules/` with raw database access (biome.json).
 */

/** Statuses a row can be retried from: never finished (`pending`) or failed and not given up (`failed`). */
const RETRYABLE = ['pending', 'failed'] as const;

export interface NewInboxEvent {
  readonly event: IdentityInboxEvent;
  readonly now: Date;
  /** Until when the inline try owns a pending row; after it, the retry loop may take it. */
  readonly leaseUntil: Date;
}

/**
 * Records a verified delivery, or nothing when its `(provider, external_event_id)` is already there (a replay):
 * resolves to the new row or undefined. An ignored delivery is stored processed at once; any other is `pending`,
 * leased to the caller's inline try.
 */
export async function recordInboxEvent(
  handle: DbHandle,
  { event, now, leaseUntil }: NewInboxEvent,
): Promise<IdentityEventRow | undefined> {
  const ignored = event.type === 'ignored';
  const [row] = await rawDb(handle)
    .insert(identityEvents)
    .values({
      provider: event.provider,
      externalEventId: event.externalEventId,
      type: event.type,
      occurredAt: new Date(event.occurredAt),
      payload: event,
      status: ignored ? 'processed' : 'pending',
      processedAt: ignored ? now : null,
      nextAttemptAt: ignored ? null : leaseUntil,
    })
    .onConflictDoNothing({ target: [identityEvents.provider, identityEvents.externalEventId] })
    .returning();
  return row;
}

/**
 * Claims up to `limit` rows that are due (`pending` or `failed`, `next_attempt_at` reached; a given-up row has none)
 * by moving their `next_attempt_at` to `leaseUntil` in one statement under `for update skip locked`, and returns
 * them oldest event first. Rows another transaction holds are skipped, not waited for.
 */
export async function claimDueInboxEvents(
  handle: DbHandle,
  { now, leaseUntil, limit }: { now: Date; leaseUntil: Date; limit: number },
): Promise<IdentityEventRow[]> {
  const db = rawDb(handle);
  const due = db
    .select({ id: identityEvents.id })
    .from(identityEvents)
    .where(
      and(
        inArray(identityEvents.status, RETRYABLE),
        isNotNull(identityEvents.nextAttemptAt),
        lte(identityEvents.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(identityEvents.nextAttemptAt), asc(identityEvents.occurredAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  const rows = await db
    .update(identityEvents)
    .set({ nextAttemptAt: leaseUntil, updatedAt: now })
    .where(inArray(identityEvents.id, due))
    .returning();
  return rows.sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** The outcome of one try, written only while the row is still retryable (a processed row stays as it is). */
export type InboxOutcome =
  | { readonly status: 'processed'; readonly attempts: number; readonly at: Date }
  | {
      readonly status: 'failed';
      readonly attempts: number;
      readonly at: Date;
      readonly lastError: string;
      /** When the next try is due; null gives the row up. */
      readonly nextAttemptAt: Date | null;
    };

/** Records a try's outcome on the row; resolves false when the row was no longer retryable. */
export async function recordInboxOutcome(
  handle: DbHandle,
  id: string,
  outcome: InboxOutcome,
): Promise<boolean> {
  const set =
    outcome.status === 'processed'
      ? { processedAt: outcome.at, lastError: null, nextAttemptAt: null }
      : { lastError: outcome.lastError, nextAttemptAt: outcome.nextAttemptAt };
  const updated = await rawDb(handle)
    .update(identityEvents)
    .set({ status: outcome.status, attempts: outcome.attempts, updatedAt: outcome.at, ...set })
    .where(and(eq(identityEvents.id, id), inArray(identityEvents.status, RETRYABLE)))
    .returning({ id: identityEvents.id });
  return updated.length > 0;
}
