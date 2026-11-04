import type { IdentityEventRow } from '@mwc/db';
import type { Logger } from 'pino';
import { describeFailure, RETRY_MAX_ATTEMPTS, retryDelayMs } from '../../../platform/jobs/retry.ts';
import { claimDueInboxEvents, recordInboxOutcome } from '../repo.ts';
import { projectIdentityEvent, type SyncDeps } from './sync.ts';

/**
 * Processing the webhook inbox: one recorded event projected (`processInboxEvent`, which the webhook route runs
 * inline), and the retry of the events whose try failed or never finished (`retryIdentityEvents`, which the jobs loop
 * of S1.10 schedules). A failed try is recorded on the row as `failed` with `attempts`, `last_error` and
 * `next_attempt_at` after the jobs' backoff (`platform/jobs/retry.ts`, as the outbox); the last allowed try that
 * fails gives the row up (`failed`, no `next_attempt_at`). The projector is idempotent and order-safe, so an event
 * retried late, twice or after newer ones converges.
 */

/** Tries of one event, the inline one included, before it is given up (the jobs' retry policy). */
export const IDENTITY_EVENT_MAX_ATTEMPTS = RETRY_MAX_ATTEMPTS;
/** How long a try owns a row it is working on before the retry loop may take the row again. */
export const INBOX_LEASE_MS = 5 * 60_000;
/** The events one `retryIdentityEvents` call claims when no limit is given. */
export const INBOX_RETRY_BATCH = 50;

export interface InboxDeps extends SyncDeps {
  readonly logger?: Logger;
}

/** What one try did: projected, failed (tried again later), given up, or skipped (another try finished first). */
export type InboxTry = 'processed' | 'failed' | 'given_up' | 'skipped';

/** When a try that starts now gives the row back to the retry loop, if it never finishes. */
export const leaseUntil = (now: Date) => new Date(now.getTime() + INBOX_LEASE_MS);

/**
 * Projects a recorded event and writes the outcome on its row: `processed`, or `failed` with the backoff (given up
 * after `IDENTITY_EVENT_MAX_ATTEMPTS` tries). A failure never rejects: it is the row's to remember.
 */
export async function processInboxEvent(deps: InboxDeps, row: IdentityEventRow): Promise<InboxTry> {
  const attempts = row.attempts + 1;
  try {
    if (row.payload.type !== 'ignored') await projectIdentityEvent(deps, row.payload);
  } catch (error) {
    const givenUp = attempts >= IDENTITY_EVENT_MAX_ATTEMPTS;
    const at = deps.clock();
    const lastError = describeFailure(error);
    // Projecting calls no provider (only the database), so there is no Retry-After to honour.
    const nextAttemptAt = givenUp ? null : new Date(at.getTime() + retryDelayMs(attempts));
    const { id, externalEventId, type } = row;
    deps.logger?.warn(
      { eventId: id, externalEventId, type, attempts, givenUp, lastError },
      'identity event failed',
    );
    const failed = { status: 'failed', attempts, at, lastError, nextAttemptAt } as const;
    if (!(await recordInboxOutcome(deps.db, row.id, failed))) return 'skipped';
    return givenUp ? 'given_up' : 'failed';
  }
  const done = await recordInboxOutcome(deps.db, row.id, { status: 'processed', attempts, at: deps.clock() });
  return done ? 'processed' : 'skipped';
}

/** What one retry pass did. */
export interface InboxRetry {
  /** Events that were due and claimed. */
  readonly claimed: number;
  readonly processed: number;
  /** Failed again; tried later. */
  readonly failed: number;
  /** Failed their last allowed try. */
  readonly givenUp: number;
}

/**
 * Claims up to `limit` due events (`pending` past their lease: an inline try that never finished; `failed` past
 * their backoff), oldest event first, under `for update skip locked`, and processes each once. For the jobs loop
 * (S1.10); a pass with nothing due does nothing.
 */
export async function retryIdentityEvents(
  deps: InboxDeps,
  { limit = INBOX_RETRY_BATCH }: { limit?: number } = {},
): Promise<InboxRetry> {
  const now = deps.clock();
  const rows = await claimDueInboxEvents(deps.db, { now, leaseUntil: leaseUntil(now), limit });
  const tally = { claimed: rows.length, processed: 0, failed: 0, givenUp: 0 };
  for (const row of rows) {
    const outcome = await processInboxEvent(deps, row);
    if (outcome === 'processed') tally.processed++;
    else if (outcome === 'failed') tally.failed++;
    else if (outcome === 'given_up') tally.givenUp++;
  }
  return tally;
}
