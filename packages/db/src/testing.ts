import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb } from './client.ts';
import type { DbHandle } from './migrate.ts';
import { createPgliteDb } from './pglite.ts';

/**
 * Test databases for the db and server integration tests. By default each one is a fresh in-memory
 * PGlite. With `TEST_DB=postgres` (the `mwc check --full` Postgres lane) each one is a new database
 * `mwc_test_<time>_<random>` created on the server in `TEST_DATABASE_URL` (the dev Postgres on 9952),
 * reached through `createDb` (postgres.js) and dropped again by `close()`, so the same tests cover
 * both drivers and never touch the dev database itself.
 */
export type TestDbKind = 'pglite' | 'postgres';

export interface TestDb {
  readonly kind: TestDbKind;
  readonly handle: DbHandle;
  /** Closes the handle (again is fine); on Postgres also drops the database. */
  close(): Promise<void>;
}

type Env = Readonly<Record<string, string | undefined>>;

export function testDbKind(env: Env = process.env): TestDbKind {
  const kind = env.TEST_DB ?? 'pglite';
  if (kind !== 'pglite' && kind !== 'postgres') {
    throw new Error(`TEST_DB must be pglite or postgres, got "${kind}"`);
  }
  return kind;
}

/** Runs one statement on the server's admin connection (the database in TEST_DATABASE_URL). */
async function onServer(url: string, statement: string): Promise<void> {
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export async function createTestDb(env: Env = process.env): Promise<TestDb> {
  if (testDbKind(env) === 'pglite') {
    const handle = await createPgliteDb();
    // A test may close the handle itself (to see a dead database); closing twice must not throw.
    return { kind: 'pglite', handle, close: async () => (handle.client.closed ? undefined : handle.close()) };
  }
  const serverUrl = env.TEST_DATABASE_URL;
  if (!serverUrl)
    throw new Error('TEST_DB=postgres needs TEST_DATABASE_URL (e.g. postgres://mwc:mwc@localhost:9952/mwc)');
  const name = `mwc_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await onServer(serverUrl, `create database "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString(), { poolSize: 2, onnotice: () => {} });
  let closed = false;
  return {
    kind: 'postgres',
    handle,
    close: async () => {
      if (closed) return;
      closed = true;
      await handle.close();
      await onServer(serverUrl, `drop database if exists "${name}" with (force)`);
    },
  };
}
