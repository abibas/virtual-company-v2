import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresDbHandle } from './client.ts';
import type { PgliteDbHandle } from './pglite.ts';
import { queryRows } from './query.ts';

export type DbHandle = PostgresDbHandle | PgliteDbHandle;

/** `packages/db/migrations`, the SQL files `drizzle-kit generate` writes. */
export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

/**
 * Where applied migrations are recorded. These are Drizzle's defaults, pinned here so that
 * `migrateToLatest` and `migrationStatus` always agree even if the defaults change.
 */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface MigrateOptions {
  /** Where the migrations are; defaults to the package's own folder (a bundled image passes its copy). */
  readonly migrationsFolder?: string;
}

/**
 * Applies every migration not yet recorded in `drizzle.__drizzle_migrations`, each in order and
 * inside one transaction. Running it again on a current database changes nothing.
 */
export async function migrateToLatest(handle: DbHandle, options: MigrateOptions = {}): Promise<void> {
  const config = {
    migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  };
  if (handle.driver === 'pglite') {
    await migratePglite(handle.db, config);
  } else {
    await migratePostgres(handle.db, config);
  }
}

export interface JournalEntry {
  readonly idx: number;
  /** The migration's file name without `.sql`, e.g. `0000_init`. */
  readonly tag: string;
  /** When it was generated (ms since the epoch); Drizzle records it as `created_at`. */
  readonly when: number;
}

/** The migrations a folder holds, in order, from its `meta/_journal.json`. */
export function readJournal(migrationsFolder: string = MIGRATIONS_FOLDER): JournalEntry[] {
  const path = join(migrationsFolder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries?: JournalEntry[] };
  if (!Array.isArray(journal.entries)) throw new Error(`${path} has no entries`);
  return journal.entries;
}

export interface MigrationStatusOptions extends MigrateOptions {
  /**
   * The journal to compare against, already read (`readJournal()`), so a caller that asks often (the
   * server's `/readyz`) reads the file once at startup; when given, `migrationsFolder` is not read.
   */
  readonly journal?: readonly JournalEntry[];
}

export interface MigrationStatus {
  /** Migrations from the journal that the database has applied. */
  readonly applied: number;
  /** Migrations in the journal. */
  readonly expected: number;
  /** Tag of the last applied migration, or null when none is. */
  readonly last: string | null;
  /** True when every migration in the journal is applied. */
  readonly current: boolean;
}

/**
 * How far the database is through the migrations in the journal. It uses Drizzle's own rule: a
 * migration counts as applied when its `when` is not after the newest `created_at` recorded in the
 * migrations table (that is what makes `migrateToLatest` skip it). A database without the table
 * has applied nothing. Rejects with the driver's error when the database does not answer.
 * Pass `journal` to skip reading the journal file on every call.
 */
export async function migrationStatus(
  handle: DbHandle,
  options: MigrationStatusOptions = {},
): Promise<MigrationStatus> {
  const entries = options.journal ?? readJournal(options.migrationsFolder);
  const qualified = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const [table] = await queryRows<{ present: boolean }>(
    handle,
    sql`select to_regclass(${qualified}) is not null as present`,
  );
  let newest = Number.NEGATIVE_INFINITY;
  if (table?.present) {
    const [row] = await queryRows<{ newest: string | null }>(
      handle,
      sql`select max(created_at)::text as newest from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
    );
    if (row?.newest != null) newest = Number(row.newest);
  }
  const applied = entries.filter((entry) => entry.when <= newest);
  return {
    applied: applied.length,
    expected: entries.length,
    last: applied.at(-1)?.tag ?? null,
    current: applied.length === entries.length,
  };
}
