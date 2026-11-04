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

/** How deep `isUniqueViolation` follows `cause`: the driver's error, Drizzle's wrapper, and two more. */
const CAUSE_DEPTH = 4;

/**
 * True for Postgres' unique violation (SQLSTATE 23505), as the driver's error or the `cause` of Drizzle's, and of
 * `constraint` when given (postgres.js names it `constraint_name`, PGlite `constraint`). Callers turn a lost race
 * or a taken value into a retry or a 409 with it, never into a 500.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current = error;
  for (let depth = 0; depth < CAUSE_DEPTH && typeof current === 'object' && current !== null; depth++) {
    const found = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
    if (found.code === '23505') {
      return constraint === undefined || (found.constraint ?? found.constraint_name) === constraint;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A statement's parameters (`$1`, `$2`, ...), sent as text for the server to type. */
export type SessionParams = readonly (string | number | boolean | null)[];

/**
 * One database session of its own, for state that lasts as long as a session does: an advisory lock (the jobs loop's
 * single runner, S1.10), later LISTEN. On Postgres it is a connection reserved from the handle's pool (postgres.js
 * `reserve()`): nothing else runs on it, and what it holds ends when the connection does, so a process that dies
 * leaves nothing held. A reserved connection that broke is not reconnected: its queries reject. On PGlite it is the
 * database's only session, shared with every other query: what it takes is held by that one session, so two holders
 * in one process never exclude each other.
 */
export interface DbSession {
  /** Runs one statement on this session and resolves to its rows. */
  query<Row extends Record<string, unknown>>(text: string, params?: SessionParams): Promise<Row[]>;
  /**
   * Gives the connection back to the pool (Postgres; PGlite keeps its one session). Whatever the session still holds
   * stays with that connection, so release it first.
   */
  release(): void;
}

/** Reserves a session on the handle's database (it waits while every pooled connection is busy). */
export async function reserveSession(handle: DbHandle): Promise<DbSession> {
  const raw = rawHandle(handle);
  if (raw.driver === 'pglite') {
    const { client } = raw;
    return {
      async query<Row extends Record<string, unknown>>(text: string, params: SessionParams = []) {
        return (await client.query<Row>(text, [...params])).rows;
      },
      release: () => {},
    };
  }
  const reserved = await raw.db.$client.reserve();
  return {
    async query<Row extends Record<string, unknown>>(text: string, params: SessionParams = []) {
      const rows: Iterable<unknown> = await reserved.unsafe(text, [...params]);
      return [...rows] as Row[];
    },
    release: () => reserved.release(),
  };
}
