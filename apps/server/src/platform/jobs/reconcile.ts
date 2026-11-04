import { companies, type DbHandle, isCompanyNotFound } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { describeFailure } from './retry.ts';

/**
 * The periodic reconcile of the jobs loop: every active company linked to an organization is reconciled with it
 * about once per interval (10 minutes by default, MWC_RECONCILE_MINUTES), each in its own slot, so they do not all
 * run at once. A company's slot starts every interval at its offset: the last 32 bits of its id (random in a UUID v7)
 * modulo the interval. It is due when it was never reconciled, or last reconciled before its current slot began.
 * Nothing lives in memory: `companies.reconciled_at` and the id say who is due, after any restart. A pass reconciles at
 * most a batch, the longest waiting first, so a backlog (the first start, a long stop) drains over a few ticks.
 */

/** The interval of MWC_RECONCILE_MINUTES' default. */
export const RECONCILE_INTERVAL_MS = 10 * 60_000;
/** Companies one pass reconciles at most. */
export const RECONCILE_BATCH = 10;

/** Where a company's slot starts in every interval: the last 8 hex digits of its id, modulo the interval. */
export function reconcileOffsetMs(companyId: string, intervalMs: number): number {
  return Number.parseInt(companyId.slice(-8), 16) % intervalMs;
}

/** When the company's current slot began: the latest instant at or before `nowMs` that lies at its offset. */
export function slotStartMs(nowMs: number, offsetMs: number, intervalMs: number): number {
  return nowMs - ((((nowMs - offsetMs) % intervalMs) + intervalMs) % intervalMs);
}

/** The due condition in SQL, as `reconcileOffsetMs` and `slotStartMs` compute it (the tests hold both to it). */
function isDue(nowMs: number, intervalMs: number) {
  const offset = sql`mod(('x' || right(${companies.id}::text, 8))::bit(32)::bigint, ${intervalMs}::bigint)`;
  const slot = sql`${nowMs}::bigint - mod(${nowMs}::bigint - ${offset}, ${intervalMs}::bigint)`;
  return sql`(${companies.reconciledAt} is null or extract(epoch from ${companies.reconciledAt}) * 1000 < ${slot})`;
}

/** The ids of up to `limit` due companies (active, linked to an organization), never reconciled or longest ago first. */
export async function dueCompanies(
  db: DbHandle,
  { now, intervalMs, limit }: { now: Date; intervalMs: number; limit: number },
): Promise<string[]> {
  const rows = await rawDb(db)
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.status, 'active'),
        isNotNull(companies.identityOrgId),
        isDue(now.getTime(), intervalMs),
      ),
    )
    .orderBy(sql`${companies.reconciledAt} asc nulls first`, asc(companies.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Records the reconcile; `updated_at` stays, since bookkeeping is no change to the company. */
async function markReconciled(db: DbHandle, companyId: string, at: Date): Promise<void> {
  await rawDb(db)
    .update(companies)
    .set({ reconciledAt: at, updatedAt: sql`${companies.updatedAt}` })
    .where(eq(companies.id, companyId));
}

export interface ReconcileDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly intervalMs: number;
  /** Reconciles one company (the identity module's `reconcileCompany`); rejects with CompanyNotFoundError once gone. */
  reconcile(companyId: string): Promise<unknown>;
  readonly limit?: number;
}

/** What one pass did: the companies that were due, reconciled, failed (tried next round) and gone meanwhile. */
export interface ReconcileRound {
  readonly due: number;
  readonly reconciled: number;
  readonly failed: number;
  readonly skipped: number;
}

/**
 * Reconciles the due companies one after the other and records each in `reconciled_at`. A failure (the provider is
 * down, a rate limit) is logged and recorded the same way, so the company comes round again in its next slot instead
 * of on every tick; a company deleted meanwhile is skipped and left as it is.
 */
export async function reconcileRound(deps: ReconcileDeps): Promise<ReconcileRound> {
  const now = deps.clock();
  const limit = deps.limit ?? RECONCILE_BATCH;
  const ids = await dueCompanies(deps.db, { now, intervalMs: deps.intervalMs, limit });
  const tally = { due: ids.length, reconciled: 0, failed: 0, skipped: 0 };
  for (const companyId of ids) {
    try {
      await deps.reconcile(companyId);
      tally.reconciled++;
    } catch (error) {
      if (isCompanyNotFound(error)) {
        tally.skipped++;
        continue;
      }
      tally.failed++;
      const reason = describeFailure(error);
      deps.logger.warn(
        { companyId, reason },
        'jobs: company reconcile failed; it comes round again next slot',
      );
    }
    await markReconciled(deps.db, companyId, deps.clock());
  }
  return tally;
}
