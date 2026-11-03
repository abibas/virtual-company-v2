/**
 * The API on a fresh in-memory PGlite, migrated on start: what the web e2e smoke runs against
 * (apps/web/playwright.config.ts), and a way to click through the UI without Docker. Nothing is
 * written to disk and everything is gone when the process stops.
 *
 *   node apps/server/src/dev-memory.ts        # listens on 127.0.0.1:9957 (MWC_PORT to change)
 */
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { migrateToLatest } from '@mwc/db';
import { createPgliteDb } from '@mwc/db/pglite';
import { loadConfig } from '@mwc/shared/config';
import { PORTS } from '@mwc/shared/ports';
import { createApp } from './app.ts';
import { createLogger } from './logger.ts';
import { gracefulShutdown } from './shutdown.ts';
import { readServerVersion } from './version.ts';

const config = loadConfig({
  ...process.env,
  // Required by the config schema but unused: the database is the in-memory PGlite below.
  DATABASE_URL: 'postgres://pglite@localhost/memory',
  MWC_PORT: process.env.MWC_PORT || String(PORTS.e2eApi),
});
const logger = await createLogger(config);
const version = readServerVersion();
const db = await createPgliteDb();
await migrateToLatest(db);

const app = createApp({ db, config, logger, version });
const server = serve({ fetch: app.fetch, port: config.MWC_PORT, hostname: config.MWC_HOST }, (info) => {
  logger.info({ host: config.MWC_HOST, port: info.port, version, db: 'pglite (memory)' }, 'listening');
}) as Server;
server.on('error', (error) => {
  logger.fatal({ err: error }, 'server error');
  process.exit(1);
});

const shutdown = gracefulShutdown({
  server,
  closeDb: () => db.close(),
  logger,
  exit: (code) => process.exit(code),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
