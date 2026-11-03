import { resolve } from 'node:path';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresDbHandle } from './client.ts';
import type { PgliteDbHandle } from './pglite.ts';

export type DbHandle = PostgresDbHandle | PgliteDbHandle;

/** `packages/db/migrations`, the SQL files `drizzle-kit generate` writes. */
export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

export interface MigrateOptions {
  /** Where the migrations are; defaults to the package's own folder (a bundled image passes its copy). */
  readonly migrationsFolder?: string;
}

/**
 * Applies every migration not yet recorded in `drizzle.__drizzle_migrations`, each in order and
 * inside one transaction. Running it again on a current database changes nothing.
 */
export async function migrateToLatest(handle: DbHandle, options: MigrateOptions = {}): Promise<void> {
  const config = { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER };
  if (handle.driver === 'pglite') {
    await migratePglite(handle.db, config);
  } else {
    await migratePostgres(handle.db, config);
  }
}
