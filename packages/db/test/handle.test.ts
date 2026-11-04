import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, isUniqueViolation, pingDb, queryRows } from '../src/handle.ts';
import { companies } from '../src/schema/index.ts';
import type { TestDb } from '../src/testing.ts';
import { insertCompany, migratedTestDb } from './fixtures/rows.ts';

describe('queryRows on postgres.js', () => {
  it('returns the rows postgres.js gives as a plain array (PGlite is covered in status.test.ts)', async () => {
    // postgres.js resolves to an array with extra fields (count, command); callers get the rows only.
    const result = Object.assign([{ one: 1 }], { count: 1, command: 'SELECT' });
    const handle = { driver: 'postgres-js', db: { execute: async () => result } } as unknown as DbHandle;
    const rows = await queryRows(handle, sql`select 1 as one`);
    expect(rows).toEqual([{ one: 1 }]);
    expect(Object.keys(rows)).toEqual(['0']);
    await expect(pingDb(handle)).resolves.toBeUndefined();
  });
});

describe('isUniqueViolation', () => {
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await migratedTestDb();
  });
  afterAll(() => testDb.close());

  async function rejection(query: PromiseLike<unknown>): Promise<unknown> {
    try {
      await query;
    } catch (error) {
      return error;
    }
    throw new Error('expected the query to fail');
  }

  it("recognizes a real unique violation through Drizzle's wrapper, by constraint on either driver", async () => {
    const taken = await insertCompany(testDb.handle);
    const other = await insertCompany(testDb.handle);
    const error = await rejection(
      testDb.handle.db.update(companies).set({ slug: taken.slug }).where(eq(companies.id, other.id)),
    );
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'companies_slug_unique')).toBe(true);
    expect(isUniqueViolation(error, 'companies_identity_org_id_unique')).toBe(false);
  });

  it('reads the constraint under either name, follows causes a few levels deep, and refuses anything else', () => {
    const pglite = Object.assign(new Error('dup'), { code: '23505', constraint: 'a_unique' });
    const postgres = Object.assign(new Error('dup'), { code: '23505', constraint_name: 'b_unique' });
    expect(isUniqueViolation(new Error('query failed', { cause: pglite }), 'a_unique')).toBe(true);
    expect(isUniqueViolation(new Error('query failed', { cause: postgres }), 'b_unique')).toBe(true);
    expect(isUniqueViolation(new Error('a', { cause: new Error('b', { cause: pglite }) }))).toBe(true);
    let deep: unknown = pglite;
    for (let i = 0; i < 4; i++) deep = new Error(`wrap ${i}`, { cause: deep });
    expect(isUniqueViolation(deep)).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
