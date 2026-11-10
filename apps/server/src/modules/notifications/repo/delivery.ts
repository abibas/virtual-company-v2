import { companies, type DbHandle, notifications } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq, isNull, min, ne, sql } from 'drizzle-orm';
import { EMAIL_MAX_WAIT_MS, EMAIL_QUIET_MS } from '../rules.ts';

/**
 * The notification emails across every company (the jobs loop): the one place this module reads without a tenant,
 * listed in biome.json's exemption, since anyone's email may be due. It only stamps and finds; each person's batch is
 * read and marked through their company's tenant (`service/delivery.ts`).
 */

/** Stamps the pending notices the loop sees for the first time with its clock; returns how many. */
export async function stampQueued(db: DbHandle, now: Date): Promise<number> {
  const rows = await rawDb(db)
    .update(notifications)
    .set({ emailQueuedAt: now })
    .where(and(eq(notifications.emailStatus, 'pending'), isNull(notifications.emailQueuedAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/** A person with pending notices in a company. */
export interface DueRecipient {
  readonly companyId: string;
  readonly recipientPrincipalId: string;
}

/**
 * The people whose pending notices are due as one email (`batchReady` in SQL), in companies not deleted, longest
 * waiting first: none waits for a retry, and the newest has been quiet a minute or the oldest has waited five.
 */
export function dueRecipients(db: DbHandle, now: Date, limit: number): Promise<DueRecipient[]> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const nowIso = now.toISOString();
  const queued = notifications.emailQueuedAt;
  return rawDb(db)
    .select({ companyId: notifications.companyId, recipientPrincipalId: notifications.recipientPrincipalId })
    .from(notifications)
    .innerJoin(companies, eq(companies.id, notifications.companyId))
    .where(
      and(
        eq(notifications.emailStatus, 'pending'),
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
      ),
    )
    .groupBy(notifications.companyId, notifications.recipientPrincipalId)
    .having(
      and(
        sql`coalesce(max(${notifications.emailNextAt}) <= ${nowIso}::timestamptz, true)`,
        sql`count(*) = count(${queued})`,
        sql`(max(${queued}) <= ${at(EMAIL_QUIET_MS)}::timestamptz or min(${queued}) <= ${at(EMAIL_MAX_WAIT_MS)}::timestamptz)`,
      ),
    )
    .orderBy(min(queued))
    .limit(limit);
}
