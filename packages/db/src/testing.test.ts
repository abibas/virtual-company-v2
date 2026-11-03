import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { queryRows } from './query.ts';
import { createTestDb, testDbKind } from './testing.ts';

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
