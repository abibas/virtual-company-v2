import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve as nodeServe } from '@hono/node-server';
import { createDb, type DbHandle, migrateToLatest } from '@mwc/db';
import { type Config, loadConfig } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { createApp } from '../app.ts';
import { createLogger } from './logger.ts';
import { gracefulShutdown } from './shutdown.ts';
import { readServerVersion } from './version.ts';

/** `serve()` of `@hono/node-server`, narrowed to what `start` uses. */
export type Serve = (
  options: {
    fetch: (request: Request) => Response | Promise<Response>;
    port: number;
    hostname: string;
  },
  onListening: (info: AddressInfo) => void,
) => Server;

/** Everything `start` does to the outside world; tests replace any of it. */
export interface StartDeps {
  /** Opens the database: Postgres at DATABASE_URL through `createDb`, which connects on the first query. */
  openDb(config: Config, logger: Logger): DbHandle | Promise<DbHandle>;
  /** How the "listening" line names the database. */
  readonly dbLabel: string;
  /** Apply the migrations before listening even when MWC_MIGRATE_ON_START is off. */
  readonly migrate: boolean;
  createLogger(config: Config): Promise<Logger>;
  readVersion(): string;
  serve: Serve;
  /** Registers a signal handler: `process.on`. */
  onSignal(signal: 'SIGTERM' | 'SIGINT', handler: (signal: string) => void): void;
  /** `process.exit`. */
  exit(code: number): void;
}

const SYSTEM: StartDeps = {
  openDb: (config, logger) =>
    createDb(config.DATABASE_URL, {
      onnotice: (notice) => logger.debug({ notice: notice.message, code: notice.code }, 'postgres notice'),
    }),
  dbLabel: 'postgres',
  migrate: false,
  createLogger: (config) => createLogger(config),
  readVersion: () => readServerVersion(),
  serve: (options, onListening) => nodeServe(options, onListening) as Server,
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  exit: (code) => process.exit(code),
};

export interface Started {
  readonly config: Config;
  readonly logger: Logger;
  readonly version: string;
  readonly db: DbHandle;
  readonly app: ReturnType<typeof createApp>;
  readonly server: Server;
  /** The SIGTERM/SIGINT handler: stop listening, let requests finish, close the database, exit. */
  readonly shutdown: (signal: string) => Promise<void>;
}

/**
 * The API server's startup, all of what `main.ts` runs: the configuration from `env` (a `ConfigError`
 * listing every problem when it is invalid, before anything is opened), the logger, the database, the
 * migrations when MWC_MIGRATE_ON_START (or `migrate`) says so, the app, the listening server, and the
 * graceful shutdown on SIGTERM and SIGINT. A server error (the port is taken) exits 1.
 */
export async function start(
  env: Readonly<Record<string, string | undefined>>,
  overrides: Partial<StartDeps> = {},
): Promise<Started> {
  const deps: StartDeps = { ...SYSTEM, ...overrides };
  const config = loadConfig({ ...env });
  const logger = await deps.createLogger(config);
  const version = deps.readVersion();
  const db = await deps.openDb(config, logger);

  if (deps.migrate || config.MWC_MIGRATE_ON_START) {
    logger.info({ db: deps.dbLabel }, 'applying migrations');
    await migrateToLatest(db);
  }

  const app = createApp({
    db,
    config,
    logger,
    version,
    ...(config.MWC_WEB_DIST ? { webDist: config.MWC_WEB_DIST } : {}),
  });
  const server = deps.serve(
    { fetch: app.fetch, port: config.MWC_PORT, hostname: config.MWC_HOST },
    (info) => {
      logger.info({ host: config.MWC_HOST, port: info.port, version, db: deps.dbLabel }, 'listening');
    },
  );
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'server error');
    deps.exit(1);
  });

  const shutdown = gracefulShutdown({ server, closeDb: () => db.close(), logger, exit: deps.exit });
  deps.onSignal('SIGTERM', shutdown);
  deps.onSignal('SIGINT', shutdown);
  return { config, logger, version, db, app, server, shutdown };
}
