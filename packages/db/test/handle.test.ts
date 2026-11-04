import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type DbHandle, isUniqueViolation, pingDb, queryRows, reserveSession } from '../src/handle.ts';
import { companies } from '../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../src/testing.ts';
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

const kind = testDbKind();
const LOCK = [7_173_987, 42] as const;
const heldBy = `select pid from pg_locks where locktype = 'advisory' and classid = $1 and objid = $2 and objsubid = 2`;

describe(`reserveSession on ${kind}`, () => {
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(() => testDb.close());

  it('runs statements with parameters on one session, which keeps what it takes until it gives it back', async () => {
    const session = await reserveSession(testDb.handle);
    const [{ pid }] = (await session.query<{ pid: number }>('select pg_backend_pid() as pid')) as [
      { pid: number },
    ];
    expect(await session.query('select $1::int + $2::int as sum, $3::text as word', [2, 3, 'x'])).toEqual([
      { sum: 5, word: 'x' },
    ]);
    expect(await session.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
      { locked: true },
    ]);
    // Still the same session: the lock is held by its backend.
    expect(await session.query(heldBy, LOCK)).toEqual([{ pid }]);
    expect(await session.query('select pg_advisory_unlock($1, $2) as unlocked', LOCK)).toEqual([
      { unlocked: true },
    ]);
    session.release();
    const again = await reserveSession(testDb.handle);
    expect(await again.query(heldBy, LOCK)).toEqual([]);
    again.release();
  });

  it.runIf(kind === 'postgres')(
    'gives each session its own connection, so their locks exclude each other',
    async () => {
      const [first, second] = [await reserveSession(testDb.handle), await reserveSession(testDb.handle)];
      try {
        const pid = async (session: typeof first) =>
          ((await session.query<{ pid: number }>('select pg_backend_pid() as pid'))[0] as { pid: number })
            .pid;
        expect(await pid(first)).not.toBe(await pid(second));
        expect(await first.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
          { locked: true },
        ]);
        expect(await second.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
          { locked: false },
        ]);
        await first.query('select pg_advisory_unlock($1, $2)', LOCK);
        expect(await second.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
          { locked: true },
        ]);
        await second.query('select pg_advisory_unlock($1, $2)', LOCK);
      } finally {
        first.release();
        second.release();
      }
    },
  );

  it.runIf(kind === 'pglite')(
    'is the one PGlite session every time, so two holders do not exclude',
    async () => {
      const [first, second] = [await reserveSession(testDb.handle), await reserveSession(testDb.handle)];
      expect(await first.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
        { locked: true },
      ]);
      expect(await second.query('select pg_try_advisory_lock($1, $2) as locked', LOCK)).toEqual([
        { locked: true },
      ]);
      await first.query('select pg_advisory_unlock($1, $2)', LOCK);
      await second.query('select pg_advisory_unlock($1, $2)', LOCK);
      first.release();
      second.release();
      expect(await first.query(heldBy, LOCK)).toEqual([]);
    },
  );
});

describe('reserveSession on postgres.js', () => {
  it('reserves a connection from the pool, runs unsafe statements on it and releases it (every lane)', async () => {
    const result = Object.assign([{ one: 1 }], { count: 1, command: 'SELECT' });
    const reserved = { unsafe: vi.fn(async () => result), release: vi.fn() };
    const handle = {
      driver: 'postgres-js',
      db: { $client: { reserve: vi.fn(async () => reserved) } },
    } as unknown as DbHandle;
    const session = await reserveSession(handle);
    const rows = await session.query('select $1::int as one', [1]);
    expect(rows).toEqual([{ one: 1 }]);
    expect(Object.keys(rows)).toEqual(['0']);
    expect(reserved.unsafe).toHaveBeenCalledWith('select $1::int as one', [1]);
    await session.query('select 1');
    expect(reserved.unsafe).toHaveBeenLastCalledWith('select 1', []);
    session.release();
    expect(reserved.release).toHaveBeenCalledOnce();
  });
});
