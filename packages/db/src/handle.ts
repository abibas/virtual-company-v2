import { type ExtractTablesWithRelations, type SQL, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PostgresDbHandle, Schema } from './client.ts';
import type { PgliteDbHandle } from './pglite.ts';

/** Either driver's handle with its Drizzle object, as `createDb` and `createPgliteDb` return it. */
export type RawDbHandle = PostgresDbHandle | PgliteDbHandle;

/**
 * A database as code outside `@mwc/db/system` holds it: something to pass to `tenant()`, `pingDb` and
 * `migrationStatus`, and to close. Its Drizzle object, raw access to every table of every company, is
 * reachable only through `@mwc/db/system` (`rawDb`), which server modules may not import (biome.json).
 */
export interface DbHandle {
  readonly driver: RawDbHandle['driver'];
  close(): Promise<void>;
}

/** The Drizzle database of either driver, or a transaction on it, typed for the shared Postgres builder. */
export type RawDb = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** The handle with its Drizzle object (every handle is one; the type only hides it). */
export function rawHandle(handle: DbHandle): RawDbHandle {
  return handle as RawDbHandle;
}

/** The raw Drizzle database behind a handle: unscoped, so only the system entry hands it out. */
export function rawDb(handle: DbHandle): RawDb {
  return rawHandle(handle).db as unknown as RawDb;
}

/**
 * Runs raw SQL on either handle and returns its rows. The drivers shape results differently
 * (postgres.js returns the rows as an array, PGlite a `{ rows }` object), so code that must work
 * on both goes through here instead of `handle.db.execute()`. Raw SQL reaches every company's rows, so
 * this is exported by `@mwc/db/system` only.
 */
export async function queryRows<Row extends Record<string, unknown>>(
  handle: DbHandle,
  query: SQL,
): Promise<Row[]> {
  const raw = rawHandle(handle);
  if (raw.driver === 'pglite') {
    const result = await raw.db.execute(query);
    return result.rows as Row[];
  }
  const rows = await raw.db.execute(query);
  return [...rows] as Row[];
}

/** `select 1`: resolves when the database answers, rejects with the driver's error otherwise. */
export async function pingDb(handle: DbHandle): Promise<void> {
  await queryRows(handle, sql`select 1 as ok`);
}
