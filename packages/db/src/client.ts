import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Notice, type Sql } from 'postgres';
import * as schema from './schema/index.ts';

export type Schema = typeof schema;

/** A Drizzle handle on a postgres.js pool. */
export interface PostgresDbHandle {
  readonly driver: 'postgres-js';
  /** `db.$client` is the postgres.js pool. */
  readonly db: PostgresJsDatabase<Schema> & { $client: Sql };
  /** Ends the pool: waits up to 5 s for running queries, then closes the connections. */
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Connections in the pool (postgres.js `max`). Default 10. */
  readonly poolSize?: number;
  /**
   * Where Postgres notices go (`NOTICE: schema "drizzle" already exists, skipping` and the like).
   * postgres.js prints them with console.log by default; the server routes them to its logger.
   */
  readonly onnotice?: (notice: Notice) => void;
}

/**
 * A Drizzle handle on Postgres through postgres.js. Nothing connects until the first query, so
 * creating a handle never fails because the database is down; `/readyz` (S0.3) reports that.
 */
export function createDb(url: string, options: CreateDbOptions = {}): PostgresDbHandle {
  const client = postgres(url, {
    max: options.poolSize ?? 10,
    ...(options.onnotice ? { onnotice: options.onnotice } : {}),
  });
  return {
    driver: 'postgres-js',
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
