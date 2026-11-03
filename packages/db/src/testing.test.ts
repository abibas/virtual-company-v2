import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { queryRows } from './query.ts';
import {
  createTestDb,
  dropStaleTestDbs,
  pgError,
  STALE_TEST_DB_AGE_MS,
  TEST_DB_PREFIX,
  testDbCreatedAt,
  testDbKind,
  testDbName,
} from './testing.ts';

describe('testDbKind', () => {
  it('defaults to pglite and accepts postgres', () => {
    expect(testDbKind({})).toBe('pglite');
    expect(testDbKind({ TEST_DB: 'pglite' })).toBe('pglite');
    expect(testDbKind({ TEST_DB: 'postgres' })).toBe('postgres');
  });

  it('refuses anything else', () => {
    expect(() => testDbKind({ TEST_DB: 'mysql' })).toThrow(/TEST_DB must be pglite or postgres/);
  });
});

describe('createTestDb', () => {
  it('gives a fresh PGlite by default', async () => {
    const testDb = await createTestDb({});
    expect(testDb.kind).toBe('pglite');
    expect(testDb.handle.driver).toBe('pglite');
    await testDb.close();
    await expect(testDb.close()).resolves.toBeUndefined();
  });

  // The --full Postgres lane shows up here by name, and fails if TEST_DB did not reach the tests.
  it(`creates a working ${testDbKind()} database from this process's environment`, async () => {
    const testDb = await createTestDb();
    expect(testDb.kind).toBe(process.env.TEST_DB ?? 'pglite');
    expect(testDb.handle.driver).toBe(testDb.kind === 'postgres' ? 'postgres-js' : 'pglite');
    expect(await queryRows(testDb.handle, sql`select 1 as one`)).toEqual([{ one: 1 }]);
    await testDb.close();
  });

  it('needs TEST_DATABASE_URL for postgres', async () => {
    await expect(createTestDb({ TEST_DB: 'postgres' })).rejects.toThrow(/TEST_DATABASE_URL/);
  });
});

describe('test database names', () => {
  it('encode their creation time, which reads back to the millisecond', () => {
    const at = Date.parse('2026-11-03T12:34:56.789Z');
    const name = testDbName(at, 'deadbeef');
    expect(name).toBe(`${TEST_DB_PREFIX}${at.toString(36)}_deadbeef`);
    expect(testDbCreatedAt(name)).toBe(at);
    expect(testDbName()).toMatch(/^mwc_test_[0-9a-z]+_[0-9a-f]{8}$/);
  });

  it.each(['mwc', 'mwc_test_keep_me', 'mwc_test_lz0abc_nothex!!', 'other_mwc_test_lz0abc_deadbeef'])(
    'reads no time from %j',
    (name) => {
      expect(testDbCreatedAt(name)).toBeUndefined();
    },
  );
});

describe('pgError', () => {
  it("unwraps the driver error's code and constraint, and fails when the query succeeds", async () => {
    const wrapped = Promise.reject(
      Object.assign(new Error('query failed'), { cause: { code: '23505', constraint_name: 'users_pkey' } }),
    );
    expect(await pgError(wrapped)).toEqual({ code: '23505', constraint: 'users_pkey' });
    expect(await pgError(Promise.reject(new Error('plain')))).toEqual({});
    await expect(pgError(Promise.resolve())).rejects.toThrow(/expected the query to fail/);
  });
});

// The sweep needs a real server: the Postgres lane only (TEST_DB=postgres).
describe.runIf(testDbKind() === 'postgres')('dropStaleTestDbs on Postgres', () => {
  const serverUrl = process.env.TEST_DATABASE_URL ?? '';
  const exists = async (admin: postgres.Sql, names: readonly string[]) =>
    (await admin<{ datname: string }[]>`select datname from pg_database where datname in ${admin(names)}`)
      .map((row) => row.datname)
      .sort();

  it('drops old idle test databases and keeps fresh, connected and foreign ones', async () => {
    const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    // A frame three hours ahead: these names are "now" for every other test process (whose own sweep
    // therefore leaves them alone) and old only for this sweep, which looks at its own names only.
    const real = Date.now();
    const now = real + 3 * STALE_TEST_DB_AGE_MS;
    const oldIdle = testDbName(real);
    const oldBusy = testDbName(real);
    const fresh = testDbName(now - 5 * 60_000);
    const foreign = `${TEST_DB_PREFIX}keep_me_${real.toString(36)}`;
    const mine = [oldIdle, oldBusy, fresh, foreign];
    const busy = postgres(Object.assign(new URL(serverUrl), { pathname: `/${oldBusy}` }).toString(), {
      max: 1,
      onnotice: () => {},
    });
    try {
      for (const name of mine) await admin.unsafe(`create database "${name}"`);
      await busy`select 1`;
      const dropped = await dropStaleTestDbs(admin, { now, only: (name) => mine.includes(name) });
      expect(dropped).toEqual([oldIdle]);
      expect(await exists(admin, mine)).toEqual([oldBusy, fresh, foreign].sort());
    } finally {
      await busy.end({ timeout: 5 });
      for (const name of mine) await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end({ timeout: 5 });
    }
  });

  it('by default sweeps with the real clock and a one-hour age', async () => {
    const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    const leftover = testDbName(Date.now() - 2 * STALE_TEST_DB_AGE_MS);
    try {
      await admin.unsafe(`create database "${leftover}"`);
      await dropStaleTestDbs(admin);
      // Another test process's first createTestDb may have swept it first; either way it is gone.
      expect(await exists(admin, [leftover])).toEqual([]);
    } finally {
      await admin.unsafe(`drop database if exists "${leftover}" with (force)`);
      await admin.end({ timeout: 5 });
    }
  });
});
