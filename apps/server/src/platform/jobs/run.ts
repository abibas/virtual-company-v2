import type { DbHandle } from '@mwc/db';
import type { IdentityProvider } from '@mwc/identity-core';
import type { Logger } from 'pino';
import type { OutboxHandlers } from './outbox.ts';
import { drainOutbox, type OutboxDrain } from './outbox-drain.ts';
import { type ReconcileRound, reconcileRound } from './reconcile.ts';

/**
 * One tick of the jobs loop: the identity outbox, then the retry of webhook events, then the periodic reconcile, each
 * on its own, so one that fails (logged) never keeps the others from running and never reaches the caller. The work
 * comes from the modules (`ModuleJobs`, composed by `moduleJobs` in app.ts), so the platform imports no module. All
 * three call the identity provider: with none (MWC_IDENTITY=none) the tick idles, and the outbox rows wait, untouched.
 */

/** A webhook retry pass's counts (the identity module's `retryIdentityEvents`). */
export interface EventRetry {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
  readonly givenUp: number;
}

/** What the jobs loop runs from the modules. */
export interface ModuleJobs {
  /** One registry of every op's outbox handler (`outboxRegistry` of the modules' handler maps). */
  readonly outboxHandlers: OutboxHandlers;
  /** Retries the due webhook inbox events. */
  retryEvents(): Promise<EventRetry>;
  /** Reconciles one company with its organization; rejects with CompanyNotFoundError once it is gone. */
  reconcileCompany(companyId: string): Promise<unknown>;
}

export interface JobsDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
  /** None (MWC_IDENTITY=none): the provider jobs idle. */
  readonly identity: IdentityProvider | undefined;
  readonly work: ModuleJobs;
  /** How often each company is reconciled (MWC_RECONCILE_MINUTES). */
  readonly reconcileIntervalMs: number;
}

export type JobName = 'outbox' | 'events' | 'reconcile';

/** What one tick did, job by job; a job that failed has no entry and is named in `failed`. */
export interface JobsTick {
  /** No identity provider: nothing ran. */
  readonly idle: boolean;
  readonly outbox?: OutboxDrain;
  readonly events?: EventRetry;
  readonly reconcile?: ReconcileRound;
  readonly failed: readonly JobName[];
}

/** Runs one tick of every job; it never rejects (each job's failure is logged and named in `failed`). */
export async function runJobsOnce(deps: JobsDeps): Promise<JobsTick> {
  if (deps.identity === undefined) return { idle: true, failed: [] };
  const failed: JobName[] = [];
  async function attempt<K extends JobName>(
    job: K,
    run: () => Promise<JobsTick[K]>,
  ): Promise<Pick<JobsTick, K>> {
    try {
      return { [job]: await run() } as Pick<JobsTick, K>;
    } catch (error) {
      failed.push(job);
      deps.logger.error({ job, err: error }, 'jobs: a job failed; the next tick tries it again');
      return {} as Pick<JobsTick, K>;
    }
  }
  const outbox = await attempt('outbox', () => drainOutbox(deps, deps.work.outboxHandlers));
  const events = await attempt('events', () => deps.work.retryEvents());
  const reconcile = await attempt('reconcile', () =>
    reconcileRound({ ...deps, intervalMs: deps.reconcileIntervalMs, reconcile: deps.work.reconcileCompany }),
  );
  return { idle: false, ...outbox, ...events, ...reconcile, failed };
}
