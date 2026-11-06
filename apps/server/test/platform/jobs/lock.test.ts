import type { DbHandle } from '@mwc/db';
import { createPgliteDb } from '@mwc/db/pglite';
import { queryRows } from '@mwc/db/system';
import { createTestDb, type TestDb, testDbKind } from '@mwc/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advisoryJobsLock, JOBS_LOCK_KEY } from '../../../src/platform/jobs/lock.ts';
import { onPglite, secondPool } from '../../fixtures/platform/jobs.ts';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

let nextKey = 100;
const newKey = () => [JOBS_LOCK_KEY[0], ++nextKey] as [number, number];
/** The backend pids holding the advisory lock `key` on `db`'s database. */
const holders = async (db: DbHandle, [classid, objid]: readonly [number, number]) =>
  (
    await queryRows<{ pid: number }>(
      db,
      sql`select pid from pg_locks where locktype = 'advisory' and classid = ${classid} and objid = ${objid} and objsubid = 2`,
    )
  ).map((row) => row.pid);

describe(`advisoryJobsLock on ${testDbKind()}`, () => {
  it('takes the lock, holds it once however often it is tried, and gives it up', async () => {
    const key = newKey();
    const lock = advisoryJobsLock(testDb.handle, key);
    expect(await lock.isHeld()).toBe(false);
    expect(await lock.tryAcquire()).toBe(true);
    expect(await lock.tryAcquire()).toBe(true);
    expect(await lock.isHeld()).toBe(true);
    expect(await holders(testDb.handle, key)).toHaveLength(1);
    await lock.release();
    expect(await lock.isHeld()).toBe(false);
    expect(await holders(testDb.handle, key)).toEqual([]);
    await lock.release();
    // Taken once and released once: nothing is left stacked on the session.
    expect(await lock.tryAcquire()).toBe(true);
    await lock.release();
    expect(await holders(testDb.handle, key)).toEqual([]);
  });

  it('notices that its session lost the lock, and can take it again', async () => {
    const key = newKey();
    const lock = advisoryJobsLock(testDb.handle, key);
    expect(await lock.tryAcquire()).toBe(true);
    const [pid] = await holders(testDb.handle, key);
    // PGlite has one session: unlock it there. Postgres: end the holder's session, as a dead connection would.
    await queryRows(
      testDb.handle,
      onPglite ? sql`select pg_advisory_unlock_all()` : sql`select pg_terminate_backend(${pid}::int)`,
    );
    expect(await lock.isHeld()).toBe(false);
    expect(await lock.tryAcquire()).toBe(true);
    await lock.release();
  });

  it('refuses a try on a database that does not answer, and lets go of a lock whose database closed', async () => {
    const closed = await createPgliteDb();
    await closed.close();
    await expect(advisoryJobsLock(closed).tryAcquire()).rejects.toThrow();

    const db = await createPgliteDb();
    const lock = advisoryJobsLock(db);
    expect(await lock.tryAcquire()).toBe(true);
    await db.close();
    expect(await lock.isHeld()).toBe(false);
    await expect(lock.release()).resolves.toBeUndefined();

    const other = await createPgliteDb();
    const held = advisoryJobsLock(other);
    expect(await held.tryAcquire()).toBe(true);
    await other.close();
    // Giving up fails with the database gone; the session is let go all the same, and so is the lock.
    await expect(held.release()).rejects.toThrow();
    expect(await held.isHeld()).toBe(false);
  });

  it.runIf(!onPglite)('lets one process hold it at a time, and frees it when the holder dies', async () => {
    const key = newKey();
    const other = await secondPool(testDb.handle);
    try {
      const [first, second] = [advisoryJobsLock(testDb.handle, key), advisoryJobsLock(other, key)];
      expect(await first.tryAcquire()).toBe(true);
      expect(await second.tryAcquire()).toBe(false);
      expect(await second.isHeld()).toBe(false);
      await first.release();
      expect(await second.tryAcquire()).toBe(true);
      expect(await first.tryAcquire()).toBe(false);
      const [pid] = await holders(testDb.handle, key);
      await queryRows(testDb.handle, sql`select pg_terminate_backend(${pid}::int)`);
      expect(await first.tryAcquire()).toBe(true);
      expect(await second.isHeld()).toBe(false);
      await first.release();
    } finally {
      await other.close();
    }
  });

  it.runIf(onPglite)(
    'cannot exclude a second holder in the same PGlite database, which is one session',
    async () => {
      const key = newKey();
      const [first, second] = [advisoryJobsLock(testDb.handle, key), advisoryJobsLock(testDb.handle, key)];
      expect(await first.tryAcquire()).toBe(true);
      expect(await second.tryAcquire()).toBe(true);
      await first.release();
      await second.release();
      expect(await holders(testDb.handle, key)).toEqual([]);
    },
  );
});
