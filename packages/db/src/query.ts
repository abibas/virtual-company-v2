import { type SQL, sql } from 'drizzle-orm';
import type { DbHandle } from './migrate.ts';

/**
 * Runs raw SQL on either handle and returns its rows. The drivers shape results differently
 * (postgres.js returns the rows as an array, PGlite a `{ rows }` object), so code that must work
 * on both goes through here instead of `handle.db.execute()`.
 */
export async function queryRows<Row extends Record<string, unknown>>(
  handle: DbHandle,
  query: SQL,
): Promise<Row[]> {
  if (handle.driver === 'pglite') {
    const result = await handle.db.execute(query);
    return result.rows as Row[];
  }
  const rows = await handle.db.execute(query);
  return [...rows] as Row[];
}

/** `select 1`: resolves when the database answers, rejects with the driver's error otherwise. */
export async function pingDb(handle: DbHandle): Promise<void> {
  await queryRows(handle, sql`select 1 as ok`);
}
