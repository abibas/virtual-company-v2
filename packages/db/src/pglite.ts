import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import type { Schema } from './client.ts';
import * as schema from './schema/index.ts';

/** A Drizzle handle on an in-memory PGlite (Postgres in WebAssembly), for tests. */
export interface PgliteDbHandle {
  readonly driver: 'pglite';
  readonly db: PgliteDatabase<Schema>;
  /** The PGlite instance, for raw SQL in tests. */
  readonly client: PGlite;
  close(): Promise<void>;
}

/** A fresh, empty in-memory database; nothing is written to disk. Run `migrateToLatest` before use. */
export async function createPgliteDb(): Promise<PgliteDbHandle> {
  const client = await PGlite.create();
  return {
    driver: 'pglite',
    db: drizzle(client, { schema }),
    client,
    close: () => client.close(),
  };
}
