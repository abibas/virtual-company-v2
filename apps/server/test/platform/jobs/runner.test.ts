import { captureLogger, LEVEL } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { advisoryJobsLock, type JobsLock } from '../../../src/platform/jobs/lock.ts';
import type { EventRetry } from '../../../src/platform/jobs/run.ts';
import {
  createJobsRunner,
  JOBS_LOCK_RETRY_MS,
  JOBS_STOP_TIMEOUT_MS,
  JOBS_TICK_MS,
  type JobsRunnerDeps,
  SYSTEM_TIMERS,
} from '../../../src/platform/jobs/runner.ts';
import { type JobsWorld, jobsWorld, manualTimers, onPglite, secondPool } from '../../fixtures/jobs.ts';

let w: JobsWorld;
beforeAll(async () => {
  w = await jobsWorld();
});
afterAll(() => w.t.close());

const NO_EVENTS: EventRetry = { claimed: 0, processed: 0, failed: 0, givenUp: 0 };

/** A lock that is free and stays held, until a test says otherwise. */
const stubLock = () =>
  ({
    tryAcquire: vi.fn(async () => true),
    isHeld: vi.fn(async () => true),
    release: vi.fn(async () => {}),
  }) satisfies JobsLock;

/** A runner on the world's database with stub work (each tick that runs the jobs calls `retryEvents` once). */
function newRunner(overrides: Partial<JobsRunnerDeps> = {}) {
  const manual = manualTimers();
  const { logger, lines } = captureLogger();
  const retryEvents = vi.fn(async () => NO_EVENTS);
  const lock = stubLock();
  const work = { outboxHandlers: {}, retryEvents, reconcileCompany: vi.fn(async () => {}) };
  const deps: JobsRunnerDeps = { ...w.jobs, logger, work, lock, timers: manual.timers, ...overrides };
  const said = (msg: string) => lines.filter((line) => line.msg === msg);
  return { runner: createJobsRunner(deps), manual, lines, said, retryEvents, lock };
}

describe('createJobsRunner', () => {
  it('ticks at once on start, takes the lock, runs the jobs, then ticks again every tick', async () => {
    const { runner, manual, retryEvents, said } = newRunner();
    expect(runner.status()).toEqual({ enabled: true, holdsLock: false, lastTickAt: null });
    runner.start();
    expect(said('jobs: starting')).toMatchObject([{ tickMs: JOBS_TICK_MS, reconcileIntervalMs: 600_000 }]);
    expect(manual.pending()).toEqual([0]);
    await manual.fire();
    expect(retryEvents).toHaveBeenCalledOnce();
    expect(runner.status()).toEqual({ enabled: true, holdsLock: true, lastTickAt: w.clock() });
    expect(said('jobs: took the jobs lock; this process runs the jobs')).toHaveLength(1);
    expect(manual.pending()).toEqual([JOBS_TICK_MS]);
    w.clock.advance(JOBS_TICK_MS);
    await manual.fire();
    expect(retryEvents).toHaveBeenCalledTimes(2);
    expect(runner.status().lastTickAt).toEqual(w.clock());
    await runner.stop();
  });

  it('never overlaps ticks: the next timer is set only once the tick in flight is over', async () => {
    let finish = () => {};
    const slow = vi.fn(
      () =>
        new Promise<EventRetry>((resolve) => {
          finish = () => resolve(NO_EVENTS);
        }),
    );
    const { runner, manual } = newRunner({
      work: { outboxHandlers: {}, retryEvents: slow, reconcileCompany: async () => {} },
    });
    runner.start();
    const tick = manual.fire();
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    expect(manual.pending()).toEqual([]);
    finish();
    await tick;
    expect(manual.pending()).toEqual([JOBS_TICK_MS]);
    expect(slow).toHaveBeenCalledOnce();
    await runner.stop();
  });

  it('waits while another process holds the lock, trying again every so often and saying so once', async () => {
    const lock = stubLock();
    lock.tryAcquire.mockResolvedValue(false);
    const { runner, manual, retryEvents, said } = newRunner({ lock });
    runner.start();
    for (let i = 0; i < 3; i++) await manual.fire();
    expect(lock.tryAcquire).toHaveBeenCalledTimes(3);
    expect(retryEvents).not.toHaveBeenCalled();
    expect(manual.pending()).toEqual([JOBS_LOCK_RETRY_MS]);
    expect(said('jobs: another process runs the jobs')).toMatchObject([{ retryMs: JOBS_LOCK_RETRY_MS }]);
    expect(runner.status()).toEqual({ enabled: true, holdsLock: false, lastTickAt: null });
    lock.tryAcquire.mockResolvedValue(true);
    await manual.fire();
    expect(retryEvents).toHaveBeenCalledOnce();
    expect(runner.status().holdsLock).toBe(true);
    await runner.stop();
  });

  it('stops running the jobs when it loses the lock, and takes it again when it can', async () => {
    const lock = stubLock();
    const { runner, manual, retryEvents, said } = newRunner({ lock, lockRetryMs: 1000 });
    runner.start();
    await manual.fire();
    lock.isHeld.mockResolvedValueOnce(false);
    lock.tryAcquire.mockResolvedValueOnce(false);
    await manual.fire();
    expect(
      said('jobs: lost the jobs lock (its database session ended); trying to take it again'),
    ).toHaveLength(1);
    expect(runner.status().holdsLock).toBe(false);
    expect(retryEvents).toHaveBeenCalledOnce();
    expect(manual.pending()).toEqual([1000]);
    await manual.fire();
    expect(runner.status().holdsLock).toBe(true);
    expect(retryEvents).toHaveBeenCalledTimes(2);
    expect(said('jobs: took the jobs lock; this process runs the jobs')).toHaveLength(2);
    await runner.stop();
  });

  it('logs a lock it cannot even try, and a tick that fails outside its jobs, and keeps going', async () => {
    const lock = stubLock();
    lock.tryAcquire.mockRejectedValueOnce(new Error('connection refused'));
    let broken = false;
    const clock = () => {
      if (broken) throw new Error('clock broke');
      return w.clock();
    };
    const { runner, manual, said, retryEvents } = newRunner({ lock, clock });
    runner.start();
    await manual.fire();
    expect(said('jobs: could not try the jobs lock')).toMatchObject([
      { level: LEVEL.warn, err: { message: 'connection refused' } },
    ]);
    expect(manual.pending()).toEqual([JOBS_LOCK_RETRY_MS]);
    broken = true;
    await manual.fire();
    expect(said('jobs: a tick failed; the next one tries again')).toMatchObject([
      { level: LEVEL.error, err: { message: 'clock broke' } },
    ]);
    expect(manual.pending()).toEqual([JOBS_TICK_MS]);
    broken = false;
    await manual.fire();
    expect(retryEvents).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it('says once that it has no identity provider, and ticks idle', async () => {
    const { runner, manual, retryEvents, said } = newRunner({ identity: undefined });
    runner.start();
    for (let i = 0; i < 3; i++) await manual.fire();
    expect(retryEvents).not.toHaveBeenCalled();
    expect(
      said('jobs: no identity provider (MWC_IDENTITY=none); the outbox, event retry and reconcile wait'),
    ).toHaveLength(1);
    expect(runner.status()).toMatchObject({ holdsLock: true, lastTickAt: w.clock() });
    await runner.stop();
  });
});

describe('stopping the jobs runner', () => {
  it('waits for the tick in flight, then gives the lock up and sets no more timers', async () => {
    let finish = () => {};
    const slow = vi.fn(() => new Promise<EventRetry>((resolve) => (finish = () => resolve(NO_EVENTS))));
    const lock = stubLock();
    const { runner, manual, said } = newRunner({
      lock,
      work: { outboxHandlers: {}, retryEvents: slow, reconcileCompany: async () => {} },
    });
    runner.start();
    void manual.fire();
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = runner.stop().then(() => (stopped = true));
    expect(runner.stop()).toBe(runner.stop());
    // Only the stop's own timeout is set while the tick finishes.
    expect(manual.pending()).toEqual([JOBS_STOP_TIMEOUT_MS]);
    expect(lock.release).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(stopped).toBe(true);
    expect(lock.release).toHaveBeenCalledOnce();
    expect(manual.pending()).toEqual([]);
    expect(runner.status().holdsLock).toBe(false);
    expect(said('jobs: stopped')).toHaveLength(1);
  });

  it('gives the lock up after the timeout when the tick in flight hangs, and stops cleanly before it ever ran', async () => {
    const hang = vi.fn(() => new Promise<EventRetry>(() => {}));
    const lock = stubLock();
    const { runner, manual, said } = newRunner({
      lock,
      stopTimeoutMs: 50,
      work: { outboxHandlers: {}, retryEvents: hang, reconcileCompany: async () => {} },
    });
    runner.start();
    void manual.fire();
    await vi.waitFor(() => expect(hang).toHaveBeenCalledOnce());
    const stopping = runner.stop();
    expect(manual.pending()).toEqual([50]);
    await manual.fire();
    await stopping;
    expect(said('jobs: a tick was still running at stop; giving the lock up anyway')).toMatchObject([
      { level: LEVEL.warn, timeoutMs: 50 },
    ]);
    expect(lock.release).toHaveBeenCalledOnce();

    const idle = newRunner();
    idle.runner.start();
    await idle.runner.stop();
    expect(idle.manual.pending()).toEqual([]);
    expect(idle.lock.release).toHaveBeenCalledOnce();
    expect(idle.retryEvents).not.toHaveBeenCalled();
  });

  it('logs a lock it could not give up: it ends with its database session anyway', async () => {
    const lock = stubLock();
    lock.release.mockRejectedValue(new Error('connection lost'));
    const { runner, manual, said } = newRunner({ lock });
    runner.start();
    await manual.fire();
    await runner.stop();
    expect(said('jobs: could not give the jobs lock up; it ends with its session')).toMatchObject([
      { level: LEVEL.warn, err: { message: 'connection lost' } },
    ]);
    expect(said('jobs: stopped')).toHaveLength(1);
  });
});

describe('SYSTEM_TIMERS', () => {
  it("are Node's timers, unref'd, and cleared on request", async () => {
    const cleared = vi.fn(async () => {});
    const handle = SYSTEM_TIMERS.setTimeout(cleared, 1) as ReturnType<typeof setTimeout>;
    expect(handle.hasRef()).toBe(false);
    SYSTEM_TIMERS.clearTimeout(handle);
    await new Promise<void>((resolve) => SYSTEM_TIMERS.setTimeout(async () => resolve(), 5));
    expect(cleared).not.toHaveBeenCalled();
  });
});

describe.runIf(!onPglite)('two jobs runners on one Postgres database', () => {
  it('lets only the one holding the lock run the jobs, and the other takes over when it stops', async () => {
    const other = await secondPool(w.t.db);
    try {
      const first = newRunner({ lock: advisoryJobsLock(w.t.db) });
      const second = newRunner({ lock: advisoryJobsLock(other), db: other });
      first.runner.start();
      second.runner.start();
      await first.manual.fire();
      await second.manual.fire();
      await first.manual.fire();
      await second.manual.fire();
      expect(first.retryEvents).toHaveBeenCalledTimes(2);
      expect(second.retryEvents).not.toHaveBeenCalled();
      expect([first.runner.status().holdsLock, second.runner.status().holdsLock]).toEqual([true, false]);
      await first.runner.stop();
      await second.manual.fire();
      expect(second.retryEvents).toHaveBeenCalledOnce();
      expect(second.runner.status().holdsLock).toBe(true);
      await second.runner.stop();
    } finally {
      await other.close();
    }
  });
});
