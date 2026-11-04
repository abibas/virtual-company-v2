import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { createDb } from './client.ts';
import type { DbHandle } from './migrate.ts';
import { createPgliteDb } from './pglite.ts';

/**
 * Test databases for the db and server integration tests. By default each one is a fresh in-memory
 * PGlite. With `TEST_DB=postgres` (the `mwc check --full` Postgres lane) each one is a new database
 * `mwc_test_<time>_<random>` created on the server in `TEST_DATABASE_URL` (the dev Postgres on 9952),
 * reached through `createDb` (postgres.js) and dropped again by `close()`, so the same tests cover
 * both drivers and never touch the dev database itself. Test databases that a killed run left behind
 * are dropped by the first `createTestDb()` of each test process (see `dropStaleTestDbs`).
 *
 * Other packages get these through `@mwc/testkit`; the db package's own tests import this file.
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

/** Every test database name starts with this; nothing else on the server may. */
export const TEST_DB_PREFIX = 'mwc_test_';

/** A test database older than this with nobody connected is left over from a killed run. */
export const STALE_TEST_DB_AGE_MS = 60 * 60 * 1000;

const TEST_DB_NAME = /^mwc_test_([0-9a-z]{1,11})_[0-9a-f]{8}$/;

/** `mwc_test_<creation time in ms, base 36>_<8 hex>`: the name carries its own creation time. */
export function testDbName(createdAtMs: number = Date.now(), random?: string): string {
  return `${TEST_DB_PREFIX}${createdAtMs.toString(36)}_${random ?? randomBytes(4).toString('hex')}`;
}

/** The creation time (ms) encoded in a test database name, or undefined for any other name. */
export function testDbCreatedAt(name: string): number | undefined {
  const match = TEST_DB_NAME.exec(name);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 36);
}

export interface DropStaleOptions {
  /** The current time (ms); default `Date.now()`. */
  readonly now?: number;
  /** Older than this counts as stale; default `STALE_TEST_DB_AGE_MS` (1 hour). */
  readonly maxAgeMs?: number;
  /** Only consider the names this accepts (a test sweeping its own fixtures); default all. */
  readonly only?: (name: string) => boolean;
}

/**
 * Drops the test databases that are older than `maxAgeMs` (by the time in their name) and have no
 * connection, and returns their names. The drop itself runs without FORCE, so a database somebody
 * connects to between the check and the drop is refused by Postgres and kept; another test process
 * sweeping at the same moment is harmless (`if exists`). Names that are not test databases are never
 * touched.
 */
export async function dropStaleTestDbs(admin: Sql, options: DropStaleOptions = {}): Promise<string[]> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STALE_TEST_DB_AGE_MS;
  const idle = await admin<{ datname: string }[]>`
    select d.datname from pg_database d
    where starts_with(d.datname, ${TEST_DB_PREFIX})
      and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`;
  const dropped: string[] = [];
  for (const { datname } of idle) {
    const createdAt = testDbCreatedAt(datname);
    if (createdAt === undefined || now - createdAt < maxAgeMs) continue;
    if (options.only && !options.only(datname)) continue;
    try {
      await admin.unsafe(`drop database if exists "${datname}"`);
      dropped.push(datname);
    } catch (error) {
      // Somebody connected in the meantime (55006 object_in_use): not stale after all.
      if ((error as { code?: string }).code !== '55006') throw error;
    }
  }
  return dropped;
}

/** How `createTestDb` reaches a Postgres server: postgres.js and `createDb`, unless a test fakes them. */
export interface TestDbServer {
  /** A one-connection client that creates, sweeps and drops the test databases. */
  admin(url: string): Sql;
  /** A handle on one test database. */
  open(url: string): DbHandle;
}

const POSTGRES: TestDbServer = {
  admin: (url) => postgres(url, { max: 1, onnotice: () => {} }),
  open: (url) => createDb(url, { poolSize: 2, onnotice: () => {} }),
};

/** Runs `work` on a one-connection admin client for the server in TEST_DATABASE_URL. */
async function onServer<T>(url: string, server: TestDbServer, work: (admin: Sql) => Promise<T>): Promise<T> {
  const admin = server.admin(url);
  try {
    return await work(admin);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Servers this process has already swept, so the sweep runs once per test process and server. */
const swept = new Set<string>();

export async function createTestDb(env: Env = process.env, server: TestDbServer = POSTGRES): Promise<TestDb> {
  if (testDbKind(env) === 'pglite') {
    const handle = await createPgliteDb();
    // A test may close the handle itself (to see a dead database); closing twice must not throw.
    return { kind: 'pglite', handle, close: async () => (handle.client.closed ? undefined : handle.close()) };
  }
  const serverUrl = env.TEST_DATABASE_URL;
  if (!serverUrl)
    throw new Error('TEST_DB=postgres needs TEST_DATABASE_URL (e.g. postgres://mwc:mwc@localhost:9952/mwc)');
  const name = testDbName();
  await onServer(serverUrl, server, async (admin) => {
    if (!swept.has(serverUrl)) {
      swept.add(serverUrl);
      await dropStaleTestDbs(admin);
    }
    await admin.unsafe(`create database "${name}"`);
  });
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const handle = server.open(url.toString());
  let closed = false;
  return {
    kind: 'postgres',
    handle,
    close: async () => {
      if (closed) return;
      closed = true;
      await handle.close();
      await onServer(serverUrl, server, (admin) =>
        admin.unsafe(`drop database if exists "${name}" with (force)`),
      );
    },
  };
}

/**
 * The Postgres error behind a rejected Drizzle query. Drizzle wraps driver errors in a
 * DrizzleQueryError whose `cause` is the driver's error with the SQLSTATE `code` and the constraint
 * name, which PGlite calls `constraint` and postgres.js `constraint_name`.
 */
export async function pgError(query: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await query;
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
    };
    const constraint = cause.constraint ?? cause.constraint_name;
    return {
      ...(cause.code === undefined ? {} : { code: cause.code }),
      ...(constraint === undefined ? {} : { constraint }),
    };
  }
  throw new Error('expected the query to fail');
}
