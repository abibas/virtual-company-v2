import type { DbHandle } from '@mwc/db';
import { migrateToLatest } from '@mwc/db';
import { createPgliteDb } from '@mwc/db/pglite';
import { type Config, loadConfig } from '@mwc/shared/config';
import pino, { type Logger } from 'pino';
import { createApp } from './app.ts';
import type { AppDeps } from './env.ts';

export const TEST_VERSION = '9.9.9-test';

export const testConfig: Config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://mwc:mwc@127.0.0.1:9999/mwc',
});

export interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** A pino logger at debug that keeps every line (parsed) instead of printing it. */
export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (line: string) => lines.push(JSON.parse(line) as LogLine) },
  );
  return { logger, lines };
}

/** pino's numeric levels, for assertions on captured lines. */
export const LEVEL = { debug: 20, info: 30, warn: 40, error: 50 } as const;

/** A database handle whose every query rejects (or never settles), as if Postgres were down or hung. */
export function brokenDb(mode: 'reject' | 'hang' = 'reject'): DbHandle {
  const execute = () =>
    mode === 'reject'
      ? Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432 user=mwc password=hunter2'))
      : new Promise(() => {});
  return { driver: 'postgres-js', db: { execute }, close: async () => {} } as unknown as DbHandle;
}

export interface TestApp {
  readonly app: ReturnType<typeof createApp>;
  readonly db: DbHandle;
  readonly lines: LogLine[];
  close(): Promise<void>;
}

/** The app on a fresh in-memory PGlite (migrated unless `migrate: false`) with a capture logger. */
export async function createTestApp(
  options: { migrate?: boolean; deps?: Partial<AppDeps> } = {},
): Promise<TestApp> {
  const db = options.deps?.db ?? (await createPgliteDb());
  if (options.migrate !== false && !options.deps?.db) await migrateToLatest(db);
  const { logger, lines } = captureLogger();
  const app = createApp({ db, config: testConfig, logger, version: TEST_VERSION, ...options.deps });
  return { app, db, lines, close: () => db.close() };
}
