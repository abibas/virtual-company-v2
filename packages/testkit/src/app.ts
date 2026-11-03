import type { DbHandle } from '@mwc/db';
import { migrateToLatest } from '@mwc/db';
import { type AppDeps, createApp } from '@mwc/server';
import { type Config, loadConfig } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { createTestDb } from './db.ts';
import { captureLogger, type LogLine } from './logger.ts';

/** The version a test app reports in /healthz, /readyz and /api/version. */
export const TEST_VERSION = '9.9.9-test';

/** A valid configuration whose DATABASE_URL points nowhere: test apps get their database as a handle. */
export const testConfig: Config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://mwc:mwc@127.0.0.1:9999/mwc',
});

/** A database handle whose every query rejects (or never settles), as if Postgres were down or hung. */
export function brokenDb(mode: 'reject' | 'hang' = 'reject'): DbHandle {
  const execute = () =>
    mode === 'reject'
      ? Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432 user=mwc password=hunter2'))
      : new Promise(() => {});
  return { driver: 'postgres-js', db: { execute }, close: async () => {} } as unknown as DbHandle;
}

export type App = ReturnType<typeof createApp>;

/** Anything `createApp` takes (`db`, `clock`, `webDist`, `journal`, ...), plus `migrate`. */
export interface TestAppOptions extends Partial<AppDeps> {
  /** Apply the migrations to the fresh test database; default true. A `db` passed in is used as is. */
  readonly migrate?: boolean;
}

export interface TestApp {
  readonly app: App;
  readonly db: DbHandle;
  /** The app's logger: a capture logger at debug unless `logger` was passed in. */
  readonly logger: Logger;
  /** Every line the capture logger received, parsed (empty when `logger` was passed in). */
  readonly logs: LogLine[];
  /** Closes the test database createTestApp made (a `db` passed in stays open); again is fine. */
  close(): Promise<void>;
}

/**
 * The API (`createApp` of `@mwc/server`) on a fresh test database, migrated, with a silent capture
 * logger, TEST_VERSION and `testConfig`. The database is an in-memory PGlite, or a new database on
 * the dev Postgres with TEST_DB=postgres (`createTestDb`). The clock is the system clock unless a
 * `clock` is passed, e.g. `fixedClock()`. Drive it in-process: `t.app.request(...)`, `getJson(t.app, ...)`.
 *
 *   const t = await createTestApp({ clock: fixedClock('2026-11-03T12:00:00Z') });
 *   afterAll(() => t.close());
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { migrate = true, ...overrides } = options;
  const testDb = overrides.db ? undefined : await createTestDb();
  const db = overrides.db ?? (testDb as NonNullable<typeof testDb>).handle;
  if (migrate && testDb) await migrateToLatest(db);
  const capture = captureLogger();
  const logger = overrides.logger ?? capture.logger;
  const app = createApp({ db, config: testConfig, version: TEST_VERSION, ...overrides, logger });
  return { app, db, logger, logs: capture.lines, close: async () => testDb?.close() };
}
