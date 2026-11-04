import { createPgliteDb } from '@mwc/db/pglite';
import { type StartDeps, type Started, start } from '../platform/start.ts';

/** Required by the config schema but unused: the database is the in-memory PGlite. */
export const MEMORY_DATABASE_URL = 'postgres://pglite@localhost/memory';

/**
 * The API on a fresh in-memory PGlite, migrated on start: a way to click through the UI without Docker
 * (`pnpm dev:memory`, then `pnpm dev:web`). It listens where the configuration says (127.0.0.1:9950 by
 * default). Nothing is written to disk, and everything is gone when the process stops.
 */
export function startMemoryServer(
  env: Readonly<Record<string, string | undefined>>,
  overrides: Partial<StartDeps> = {},
): Promise<Started> {
  return start(
    { ...env, DATABASE_URL: MEMORY_DATABASE_URL },
    { openDb: () => createPgliteDb(), dbLabel: 'pglite (memory)', migrate: true, ...overrides },
  );
}
