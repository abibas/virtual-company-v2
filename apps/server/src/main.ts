/**
 * The API server process: `node apps/server/src/main.ts` (Node 24 runs the TypeScript sources
 * directly). Config comes from the environment (`@mwc/shared/config`); see .env.example.
 */
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createDb, migrateToLatest } from '@mwc/db';
import { loadConfig } from '@mwc/shared/config';
import { createApp } from './app.ts';
import { createLogger } from './logger.ts';
import { gracefulShutdown } from './shutdown.ts';
import { readServerVersion } from './version.ts';

const config = loadConfig();
const logger = await createLogger(config);
const version = readServerVersion();
const db = createDb(config.DATABASE_URL, {
  onnotice: (notice) => logger.debug({ notice: notice.message, code: notice.code }, 'postgres notice'),
});

if (config.MWC_MIGRATE_ON_START) {
  logger.info('applying migrations (MWC_MIGRATE_ON_START)');
  await migrateToLatest(db);
}

const app = createApp({ db, config, logger, version });
const server = serve({ fetch: app.fetch, port: config.MWC_PORT, hostname: config.MWC_HOST }, (info) => {
  logger.info({ host: config.MWC_HOST, port: info.port, version }, 'listening');
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
