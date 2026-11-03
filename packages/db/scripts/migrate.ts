/**
 * Applies pending migrations to DATABASE_URL and prints where the database stands. The compose
 * `migrate` one-shot (deploy/compose.prod.yml) and `mwc dev` run it; so can you:
 *
 *   DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc node packages/db/scripts/migrate.ts
 *
 * Exit 0 when every migration is applied, 1 when migrating failed, 2 without DATABASE_URL.
 * Runs on Node's own TypeScript support (no tsx), like the server.
 */
import { createDb } from '../src/client.ts';
import { migrateToLatest, migrationStatus } from '../src/migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('migrate: DATABASE_URL is not set\n');
  process.exit(2);
}

// Never print the password: host, port and database name are enough to know where it went.
const where = (() => {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
})();

const handle = createDb(url, { poolSize: 1, onnotice: () => {} });
try {
  await migrateToLatest(handle);
  const status = await migrationStatus(handle);
  process.stdout.write(
    `migrate: ${where} has ${status.applied} of ${status.expected} migrations applied (last: ${status.last ?? 'none'})\n`,
  );
  process.exitCode = status.current ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `migrate: ${where} failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await handle.close();
}
