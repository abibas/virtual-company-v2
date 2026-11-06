/**
 * The jobs tests' helpers: timers fired by hand, a world whose clock runs ahead of the database's own `now()` (so the
 * rows it stamps by default are due at once), the jobs of that world composed from the modules as `start` does, and
 * a second connection pool on the same Postgres test database, as another server process would have.
 */
import { companies, type DbHandle } from '@mwc/db';
import { createDb, queryRows, rawDb } from '@mwc/db/system';
import { testConfig, testDbKind } from '@mwc/testkit';
import { eq, sql } from 'drizzle-orm';
import { moduleJobs } from '../../../src/app.ts';
import type { JobsDeps } from '../../../src/platform/jobs/run.ts';
import type { Timers } from '../../../src/platform/jobs/runner.ts';
import { type AuthWorld, authWorld } from './auth.ts';

/** Tests on PGlite (the default lane) or on the dev Postgres (`--full`). */
export const onPglite = testDbKind() === 'pglite';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

export interface ManualTimers {
  readonly timers: Timers;
  /** The delays of the timers set and not fired or cleared yet, oldest first. */
  pending(): number[];
  /** Fires the oldest timer and resolves when the tick it started is over (the test fails when none is set). */
  fire(): Promise<void>;
}

/** Timers that only fire when the test says so. */
export function manualTimers(): ManualTimers {
  const queue = new Map<number, { callback: () => Promise<void>; ms: number }>();
  let next = 0;
  return {
    timers: {
      setTimeout: (callback, ms) => {
        queue.set(++next, { callback, ms });
        return next;
      },
      clearTimeout: (handle) => {
        queue.delete(handle as number);
      },
    },
    pending: () => [...queue.values()].map((entry) => entry.ms),
    async fire() {
      const first = queue.entries().next();
      if (first.done) throw new Error('no timer is set');
      const [id, entry] = first.value;
      queue.delete(id);
      await entry.callback();
    },
  };
}

export interface JobsWorld extends AuthWorld {
  /** The deps of `runJobsOnce` on this world: its database, fake provider and clock, the modules' jobs. */
  readonly jobs: JobsDeps;
}

/**
 * The auth world (`authWorld()`: the fake provider and a test app on one fixed clock), with the clock a day ahead of
 * real time: `next_attempt_at` and `created_at` default to the database's `now()`, so new rows are due at once.
 */
export async function jobsWorld(reconcileIntervalMs = 10 * MINUTE_MS): Promise<JobsWorld> {
  const world = await authWorld();
  world.clock.set(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS);
  const server = {
    db: world.t.db,
    config: testConfig,
    logger: world.t.logger,
    version: 'test',
    clock: world.clock,
    identity: world.fake,
  };
  const jobs: JobsDeps = { ...server, work: moduleJobs(server), reconcileIntervalMs };
  return { ...world, jobs };
}

/** A company's `reconciled_at`. */
export const reconciledAt = async (db: DbHandle, companyId: string) =>
  (await rawDb(db).select().from(companies).where(eq(companies.id, companyId)))[0]?.reconciledAt ?? null;

/** Sets a company's `reconciled_at` (null for never). */
export async function setReconciledAt(db: DbHandle, companyId: string, at: Date | null): Promise<void> {
  await rawDb(db).update(companies).set({ reconciledAt: at }).where(eq(companies.id, companyId));
}

/** Another pool on the test database `db` is on (Postgres only): what a second server process would open. */
export async function secondPool(db: DbHandle): Promise<DbHandle> {
  const [row] = await queryRows<{ name: string }>(db, sql`select current_database() as name`);
  const url = new URL(process.env.TEST_DATABASE_URL ?? '');
  url.pathname = `/${row?.name}`;
  return createDb(url.toString(), { poolSize: 2, onnotice: () => {} });
}
