import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, migrateToLatest } from './migrate.ts';
import { createPgliteDb, type PgliteDbHandle } from './pglite.ts';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ tag: string }>;
};

async function appliedCount(handle: PgliteDbHandle): Promise<number> {
  const result = await handle.client.query<{ n: number }>(
    'select count(*)::int as n from drizzle.__drizzle_migrations',
  );
  return result.rows[0]?.n ?? -1;
}

describe('migrateToLatest on PGlite', () => {
  let handle: PgliteDbHandle | undefined;
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('starts from 0000_init', () => {
    expect(journal.entries[0]?.tag).toBe('0000_init');
  });

  it('creates the S0 tables on a fresh database and records every migration', async () => {
    handle = await createPgliteDb();
    await migrateToLatest(handle);
    const tables = await handle.client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(['audit_log', 'companies', 'users']);
    expect(await appliedCount(handle)).toBe(journal.entries.length);
  });

  it('is a no-op the second time', async () => {
    handle = await createPgliteDb();
    await migrateToLatest(handle);
    const first = await appliedCount(handle);
    await expect(migrateToLatest(handle)).resolves.toBeUndefined();
    expect(await appliedCount(handle)).toBe(first);
  });

  it('fails clearly for a folder without migrations', async () => {
    handle = await createPgliteDb();
    await expect(migrateToLatest(handle, { migrationsFolder: '/nonexistent/migrations' })).rejects.toThrow(
      /journal/i,
    );
  });
});
