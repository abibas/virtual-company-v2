import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type DbHandle, MIGRATIONS_FOLDER, migrateToLatest } from '../src/migrate.ts';
import { queryRows } from '../src/query.ts';
import { createTestDb, type TestDb, testDbKind } from '../src/testing.ts';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ tag: string }>;
};

async function appliedCount(handle: DbHandle): Promise<number> {
  const [row] = await queryRows<{ n: number }>(
    handle,
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  return row?.n ?? -1;
}

describe(`migrateToLatest on ${testDbKind()}`, () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });
  const fresh = async () => {
    testDb = await createTestDb();
    return testDb.handle;
  };

  it('starts from 0000_init', () => {
    expect(journal.entries[0]?.tag).toBe('0000_init');
  });

  it('creates the S0 tables on a fresh database and records every migration', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    const tables = await queryRows<{ table_name: string }>(
      handle,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual(['audit_log', 'companies', 'users']);
    expect(await appliedCount(handle)).toBe(journal.entries.length);
  });

  it('is a no-op the second time', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    const first = await appliedCount(handle);
    await expect(migrateToLatest(handle)).resolves.toBeUndefined();
    expect(await appliedCount(handle)).toBe(first);
  });

  it('fails clearly for a folder without migrations', async () => {
    const handle = await fresh();
    await expect(migrateToLatest(handle, { migrationsFolder: '/nonexistent/migrations' })).rejects.toThrow(
      /journal/i,
    );
  });
});
