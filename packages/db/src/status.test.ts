import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type DbHandle,
  MIGRATIONS_FOLDER,
  migrateToLatest,
  migrationStatus,
  readJournal,
} from './migrate.ts';
import { pingDb, queryRows } from './query.ts';
import { createTestDb, type TestDb, testDbKind } from './testing.ts';

const journal = readJournal();
const lastTag = journal.at(-1)?.tag;

/** A copy of the migrations folder with one more migration after the real ones. */
let aheadFolder: string;
beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'mwc-migrations-ahead-'));
  aheadFolder = join(root, 'migrations');
  cpSync(MIGRATIONS_FOLDER, aheadFolder, { recursive: true });
  const entries = [
    ...journal,
    { idx: journal.length, version: '7', when: Date.now(), tag: '9999_probe', breakpoints: true },
  ];
  writeFileSync(
    join(aheadFolder, 'meta/_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  writeFileSync(join(aheadFolder, '9999_probe.sql'), 'create table "probe" ("id" integer primary key);');
});
afterAll(() => {
  rmSync(join(aheadFolder, '..'), { recursive: true, force: true });
});

describe('readJournal', () => {
  it('lists the committed migrations in order', () => {
    expect(journal.map((entry) => entry.idx)).toEqual(journal.map((_, i) => i));
    expect(journal[0]?.tag).toBe('0000_init');
  });

  it('fails for a folder without a journal, or a journal without entries', () => {
    expect(() => readJournal('/nonexistent/migrations')).toThrow(/_journal\.json/);
    const root = mkdtempSync(join(tmpdir(), 'mwc-migrations-empty-'));
    try {
      cpSync(MIGRATIONS_FOLDER, root, { recursive: true });
      writeFileSync(join(root, 'meta/_journal.json'), '{"version":"7"}');
      expect(() => readJournal(root)).toThrow(/has no entries/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe(`migrationStatus on ${testDbKind()}`, () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });
  const fresh = async () => {
    testDb = await createTestDb();
    return testDb.handle;
  };

  it('reports nothing applied on a fresh database (no migrations table yet)', async () => {
    const handle = await fresh();
    expect(await migrationStatus(handle)).toEqual({
      applied: 0,
      expected: journal.length,
      last: null,
      current: false,
    });
  });

  it('reports nothing applied when the migrations table exists but is empty', async () => {
    const handle = await fresh();
    await queryRows(handle, sql`create schema drizzle`);
    await queryRows(
      handle,
      sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
    );
    expect(await migrationStatus(handle)).toMatchObject({ applied: 0, last: null, current: false });
  });

  it('is current after migrateToLatest, naming the last migration', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    expect(await migrationStatus(handle)).toEqual({
      applied: journal.length,
      expected: journal.length,
      last: lastTag,
      current: true,
    });
  });

  it('is behind when the code has a migration the database has not applied, and current after it', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    const behind = await migrationStatus(handle, { migrationsFolder: aheadFolder });
    expect(behind).toEqual({
      applied: journal.length,
      expected: journal.length + 1,
      last: lastTag,
      current: false,
    });
    await migrateToLatest(handle, { migrationsFolder: aheadFolder });
    expect(await migrationStatus(handle, { migrationsFolder: aheadFolder })).toMatchObject({
      applied: journal.length + 1,
      last: '9999_probe',
      current: true,
    });
  });

  it('rejects when the database does not answer', async () => {
    const handle = await fresh();
    await handle.close();
    await expect(migrationStatus(handle)).rejects.toThrow();
  });
});

describe(`queryRows and pingDb on ${testDbKind()}`, () => {
  let testDb: TestDb;
  let handle: DbHandle;
  beforeAll(async () => {
    testDb = await createTestDb();
    handle = testDb.handle;
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('returns the rows of a raw query as an array', async () => {
    const rows = await queryRows<{ n: number }>(handle, sql`select generate_series(1, 3) as n`);
    expect(rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('pings a live database', async () => {
    await expect(pingDb(handle)).resolves.toBeUndefined();
  });
});
