import type { JobsLock } from './lock.ts';
import { type JobsDeps, runJobsOnce } from './run.ts';
import type { JobsStatus, JobsView } from './status.ts';

/**
 * The jobs loop of a server process (MWC_JOBS=on), started by `platform/start.ts`: one timer at a time, so ticks
 * never overlap. A tick first makes sure this process holds the jobs lock (`lock.ts`: one runner per database), then
 * runs `runJobsOnce`, then sets the next timer. A process without the lock tries again every `lockRetryMs`; one that
 * loses it (its database session ended) stops running jobs until it takes it again. Nothing it decides lives only in
 * memory: the rows say what is due. `stop()` (graceful shutdown) clears the timer, waits for the tick in flight up to
 * `stopTimeoutMs`, and gives the lock up.
 */

/** Time between two ticks of the process that holds the lock. */
export const JOBS_TICK_MS = 5_000;
/** Time between two tries to take the lock, for a process that does not hold it. */
export const JOBS_LOCK_RETRY_MS = 30_000;
/** How long `stop()` waits for a tick in flight before it gives the lock up anyway. */
export const JOBS_STOP_TIMEOUT_MS = 5_000;

/** The timers the loop uses; tests pass ones they fire by hand. A callback's promise is the tick it started. */
export interface Timers {
  setTimeout(callback: () => Promise<void>, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Node's timers, unref'd so a pending tick never keeps the process alive. */
export const SYSTEM_TIMERS: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface JobsRunnerDeps extends JobsDeps {
  readonly lock: JobsLock;
  readonly timers?: Timers;
  readonly tickMs?: number;
  readonly lockRetryMs?: number;
  readonly stopTimeoutMs?: number;
}

export interface JobsRunner extends JobsView {
  /** Starts the loop: the first tick comes at once. */
  start(): void;
  /** Stops the loop, waits for the tick in flight (with a timeout) and gives the lock up; again is a no-op. */
  stop(): Promise<void>;
}

/** The loop's state; `createJobsRunner` hands it out as a `JobsRunner`. */
class JobsLoop implements JobsRunner {
  readonly #deps: JobsRunnerDeps;
  readonly #timers: Timers;
  readonly #tickMs: number;
  readonly #lockRetryMs: number;
  #timer: unknown;
  #inFlight: Promise<void> | undefined;
  #holding = false;
  #waitingSaid = false;
  #stopping: Promise<void> | undefined;
  #lastTickAt: Date | null = null;

  constructor(deps: JobsRunnerDeps) {
    this.#deps = deps;
    this.#timers = deps.timers ?? SYSTEM_TIMERS;
    this.#tickMs = deps.tickMs ?? JOBS_TICK_MS;
    this.#lockRetryMs = deps.lockRetryMs ?? JOBS_LOCK_RETRY_MS;
  }

  start(): void {
    const { logger, identity, reconcileIntervalMs } = this.#deps;
    logger.info({ tickMs: this.#tickMs, reconcileIntervalMs }, 'jobs: starting');
    if (identity === undefined) {
      logger.info(
        'jobs: no identity provider (MWC_IDENTITY=none); the outbox, event retry and reconcile wait',
      );
    }
    this.#schedule(0);
  }

  stop(): Promise<void> {
    this.#stopping ??= this.#shutDown();
    return this.#stopping;
  }

  status(): JobsStatus {
    return { enabled: true, holdsLock: this.#holding, lastTickAt: this.#lastTickAt };
  }

  /** Sets the one timer of the next tick, unless the loop is stopping. */
  #schedule(ms: number): void {
    if (this.#stopping !== undefined) return;
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = undefined;
      this.#inFlight = this.#step().finally(() => {
        this.#inFlight = undefined;
      });
      return this.#inFlight;
    }, ms);
  }

  /** One tick; it never rejects, so a failure can never take the process down. */
  async #step(): Promise<void> {
    try {
      if (!(await this.#ensureLock())) return this.#schedule(this.#lockRetryMs);
      await runJobsOnce(this.#deps);
      this.#lastTickAt = this.#deps.clock();
    } catch (error) {
      this.#deps.logger.error({ err: error }, 'jobs: a tick failed; the next one tries again');
    }
    this.#schedule(this.#tickMs);
  }

  /** True when this process holds the lock now, taking it when it can; never rejects. */
  async #ensureLock(): Promise<boolean> {
    const { lock, logger } = this.#deps;
    try {
      if (this.#holding && (await lock.isHeld())) return true;
      if (this.#holding)
        logger.warn('jobs: lost the jobs lock (its database session ended); trying to take it again');
      this.#holding = await lock.tryAcquire();
    } catch (error) {
      this.#holding = false;
      logger.warn({ err: error }, 'jobs: could not try the jobs lock');
      return false;
    }
    if (this.#holding) {
      this.#waitingSaid = false;
      logger.info('jobs: took the jobs lock; this process runs the jobs');
    } else if (!this.#waitingSaid) {
      this.#waitingSaid = true;
      logger.info({ retryMs: this.#lockRetryMs }, 'jobs: another process runs the jobs');
    }
    return this.#holding;
  }

  /** Resolves when `work` settles or after `ms`, whichever comes first; true when it settled. */
  #settles(work: Promise<void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const giveUp = this.#timers.setTimeout(async () => resolve(false), ms);
      void work.then(() => {
        this.#timers.clearTimeout(giveUp);
        resolve(true);
      });
    });
  }

  async #shutDown(): Promise<void> {
    const { lock, logger } = this.#deps;
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    const timeoutMs = this.#deps.stopTimeoutMs ?? JOBS_STOP_TIMEOUT_MS;
    if (this.#inFlight !== undefined && !(await this.#settles(this.#inFlight, timeoutMs))) {
      logger.warn({ timeoutMs }, 'jobs: a tick was still running at stop; giving the lock up anyway');
    }
    try {
      await lock.release();
    } catch (error) {
      logger.warn({ err: error }, 'jobs: could not give the jobs lock up; it ends with its session');
    }
    this.#holding = false;
    logger.info('jobs: stopped');
  }
}

/** The jobs loop on `deps`; nothing runs before `start()`. */
export function createJobsRunner(deps: JobsRunnerDeps): JobsRunner {
  return new JobsLoop(deps);
}
