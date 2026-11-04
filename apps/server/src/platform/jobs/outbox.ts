import {
  type DbHandle,
  type IdentityOutboxRow,
  identityOutbox,
  isCompanyNotFound,
  type TenantDb,
  tenant,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { type IdentityProvider, isIdentityProviderError } from '@mwc/identity-core';
import type { IdentityOutboxOp } from '@mwc/shared/enums';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  describeFailure,
  ERROR_LENGTH,
  RETRY_FIRST_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  retryDelayMs,
} from './retry.ts';

/**
 * The identity outbox (local first: a change lands here at once, the identity provider follows): enqueueing a
 * provider call in the caller's transaction, and recording what a handler made of one row. The jobs loop (S1.10)
 * picks the due rows and calls `processOutboxRow` with the handler of each row's op; the modules own the handlers
 * (`companies`: create_org, delete_org; `members`: update_role, remove_member, invite, revoke_invite).
 */

/** Tries of one row before it is given up as `failed` (the jobs' retry policy, `retry.ts`). */
export const OUTBOX_MAX_ATTEMPTS = RETRY_MAX_ATTEMPTS;
/** The first retry delay; it doubles with every failed try. */
export const OUTBOX_FIRST_DELAY_MS = RETRY_FIRST_DELAY_MS;
/** The longest retry delay, unless the provider asked for longer (Retry-After). */
export const OUTBOX_MAX_DELAY_MS = RETRY_MAX_DELAY_MS;
/** `last_error` is cut to this many characters. */
export const OUTBOX_ERROR_LENGTH = ERROR_LENGTH;
export { describeFailure, retryDelayMs };

/** The deterministic idempotency key of a provider call: the op and what it is about (`create_org:<companyId>`). */
export function outboxKey(op: IdentityOutboxOp, ...about: readonly string[]): string {
  return [op, ...about].join(':');
}

export interface OutboxEntry {
  readonly op: IdentityOutboxOp;
  readonly payload?: Record<string, unknown>;
  /** Usually `outboxKey(op, ...)`: the same call enqueued twice stays one row. */
  readonly idempotencyKey: string;
}

/**
 * Enqueues a provider call in the tenant's company, inside the caller's transaction when the tenant is one, so the
 * call is owed exactly when the local change commits. A key already enqueued keeps its row; resolves to the new
 * row, or undefined when the key was there.
 */
export async function enqueueOutbox(t: TenantDb, entry: OutboxEntry): Promise<IdentityOutboxRow | undefined> {
  const [row] = await t
    .insert(identityOutbox, {
      op: entry.op,
      payload: entry.payload ?? {},
      idempotencyKey: entry.idempotencyKey,
    })
    .onConflictDoNothing({ target: identityOutbox.idempotencyKey })
    .returning();
  return row;
}

/** Does one row's provider call; resolving means done (also "nothing left to do"), rejecting means try again. */
export type OutboxHandler = (row: IdentityOutboxRow) => Promise<void>;

/**
 * A failure no retry can fix (the provider refused the call for good, such as an invitation it will not send): a
 * handler throws it to have `processOutboxRow` fail the row at once, with the cause's description as `last_error`.
 */
export class OutboxGiveUpError extends Error {
  constructor(cause: unknown) {
    super(describeFailure(cause), { cause });
    this.name = 'OutboxGiveUpError';
  }
}

/** True while a handler runs a row's last allowed try: failing now marks the row `failed` for good. */
export function isLastAttempt(row: Pick<IdentityOutboxRow, 'attempts'>): boolean {
  return row.attempts + 1 >= OUTBOX_MAX_ATTEMPTS;
}

/** The provider a handler calls; none configured (MWC_IDENTITY=none) rejects, so the row is tried again later. */
export function outboxProvider(identity: IdentityProvider | undefined): IdentityProvider {
  if (identity === undefined) throw new Error('No identity provider is configured (MWC_IDENTITY=none)');
  return identity;
}

/** The tenant of a row's company, or undefined once the company is deleted (a handler then has nothing to do). */
export async function outboxTenant(db: DbHandle, companyId: string): Promise<TenantDb | undefined> {
  try {
    return await tenant(db, companyId);
  } catch (error) {
    if (isCompanyNotFound(error)) return undefined;
    throw error;
  }
}

/** The handlers a module offers, by op. */
export type OutboxHandlers = Partial<Record<IdentityOutboxOp, OutboxHandler>>;

export type OutboxOutcome = 'done' | 'retry' | 'failed' | 'skipped';

export interface OutboxDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger?: Logger;
}

/**
 * Runs `handler` on a pending row and records the outcome on it. Done: `status = done`, `completed_at`, the try
 * counted. A failure (the provider's error or any other) stays `pending` with the try counted, `last_error` and
 * `next_attempt_at` pushed back by `retryDelayMs`, so the loop tries it again later; the last allowed try that
 * fails marks it `failed`, and so does an `OutboxGiveUpError` on any try. A row that is not pending is skipped
 * untouched. The outcome is written only while the row is still pending.
 */
export async function processOutboxRow(
  deps: OutboxDeps,
  row: IdentityOutboxRow,
  handler: OutboxHandler,
): Promise<OutboxOutcome> {
  if (row.status !== 'pending') return 'skipped';
  const attempts = row.attempts + 1;
  const pending = and(eq(identityOutbox.id, row.id), eq(identityOutbox.status, 'pending'));
  try {
    await handler(row);
  } catch (error) {
    const failed = attempts >= OUTBOX_MAX_ATTEMPTS || error instanceof OutboxGiveUpError;
    const retryAfterMs = isIdentityProviderError(error) ? error.retryAfterMs : undefined;
    const nextAttemptAt = new Date(deps.clock().getTime() + retryDelayMs(attempts, retryAfterMs));
    const lastError = describeFailure(error);
    deps.logger?.warn(
      { outboxId: row.id, op: row.op, attempts, failed, lastError },
      'identity outbox call failed',
    );
    await rawDb(deps.db)
      .update(identityOutbox)
      .set({ attempts, lastError, ...(failed ? { status: 'failed' as const } : { nextAttemptAt }) })
      .where(pending);
    return failed ? 'failed' : 'retry';
  }
  await rawDb(deps.db)
    .update(identityOutbox)
    .set({ status: 'done', attempts, completedAt: deps.clock(), lastError: null })
    .where(pending);
  return 'done';
}
