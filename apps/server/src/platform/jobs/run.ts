import type { DbHandle } from '@mwc/db';
import type { IdentityProvider } from '@mwc/identity-core';
import type { Logger } from 'pino';
import type { OutboxHandlers } from './outbox.ts';
import { drainOutbox, type OutboxDrain } from './outbox-drain.ts';
import { type ReconcileRound, reconcileRound } from './reconcile.ts';

/**
 * One tick of the jobs loop: the machines' upkeep and the notification emails, then the identity outbox, the retry of webhook events and the
 * periodic reconcile, each on its own, so one that fails (logged) never keeps the others from running and never reaches
 * the caller. The work comes from the modules (`ModuleJobs`, composed by `moduleJobs` in app.ts), so the platform imports
 * no module. The last three call the identity provider: with none (MWC_IDENTITY=none) they idle, and the outbox rows
 * wait, untouched; the machines' upkeep and the notification emails run either way.
 */

/** A webhook retry pass's counts (the identity module's `retryIdentityEvents`). */
export interface EventRetry {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
  readonly givenUp: number;
}

/** A machines upkeep pass's counts (the machines module's `machineUpkeep`). */
export interface MachineUpkeep {
  /** Machines taken offline because their runner's lease lapsed. */
  readonly offline: number;
  /** Samples older than 7 days deleted; null on the ticks that do not prune (it runs hourly). */
  readonly pruned: number | null;
  /**
   * The power scheduler's step: machines decided, holds changed, starts, stops and box readings begun; null on the
   * ticks that do not step (it steps once a minute).
   */
  readonly power: { readonly machines: number; readonly holds: number; readonly commands: number } | null;
}

/** A notification email pass's counts (the notifications module's `deliverEmails`). */
export interface NotificationEmails {
  /** Pending notices seen for the first time (their batch's minute starts). */
  readonly queued: number;
  readonly sent: number;
  readonly skipped: number;
  readonly retry: number;
  readonly failed: number;
  /** Due people whose batch got a new notice meanwhile, or whose company is gone. */
  readonly waiting: number;
}

/** What the jobs loop runs from the modules. */
export interface ModuleJobs {
  /** One pass of the notification emails: each person's batch of a quiet minute, retried with the backoff. */
  notifications(): Promise<NotificationEmails>;
  /** The offline sweep, the hourly prune of machine samples and the power scheduler's step each minute. */
  machines(): Promise<MachineUpkeep>;
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

export type JobName = 'machines' | 'notifications' | 'outbox' | 'events' | 'reconcile';

/** What one tick did, job by job; a job that failed has no entry and is named in `failed`. */
export interface JobsTick {
  /** No identity provider: only the machines' upkeep and the notification emails ran. */
  readonly idle: boolean;
  readonly machines?: MachineUpkeep;
  readonly notifications?: NotificationEmails;
  readonly outbox?: OutboxDrain;
  readonly events?: EventRetry;
  readonly reconcile?: ReconcileRound;
  readonly failed: readonly JobName[];
}

/** Runs one tick of every job; it never rejects (each job's failure is logged and named in `failed`). */
export async function runJobsOnce(deps: JobsDeps): Promise<JobsTick> {
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
  const machines = await attempt('machines', () => deps.work.machines());
  const notifications = await attempt('notifications', () => deps.work.notifications());
  if (deps.identity === undefined) return { idle: true, ...machines, ...notifications, failed };
  const outbox = await attempt('outbox', () => drainOutbox(deps, deps.work.outboxHandlers));
  const events = await attempt('events', () => deps.work.retryEvents());
  const reconcile = await attempt('reconcile', () =>
    reconcileRound({ ...deps, intervalMs: deps.reconcileIntervalMs, reconcile: deps.work.reconcileCompany }),
  );
  return { idle: false, ...machines, ...notifications, ...outbox, ...events, ...reconcile, failed };
}
