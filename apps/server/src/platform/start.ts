import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve as nodeServe } from '@hono/node-server';
import { createDb, type DbHandle, migrateToLatest } from '@mwc/db/system';
import { type Config, loadConfig } from '@mwc/shared/config';
import type { Logger } from 'pino';
import type { WebSocketServer } from 'ws';
import { createApp, machinesRuntime, moduleJobs, reapTurns } from '../app.ts';
import type { ServerDeps } from './env.ts';
import { identityFromConfig } from './identity.ts';
import { advisoryJobsLock } from './jobs/lock.ts';
import { createJobsRunner, type JobsRunner, SYSTEM_TIMERS, type Timers } from './jobs/runner.ts';
import { JOBS_OFF } from './jobs/status.ts';
import { createLogger } from './logger.ts';
import { loginHelperFromConfig } from './processes/login-helper/select.ts';
import { type LocalPower, localPowerFromConfig } from './processes/power/local.ts';
import { createSocketServer } from './realtime/sockets.ts';
import type { Keyring } from './secrets/keyring.ts';
import { DEV_DATA_DIR, loadKeyring } from './secrets/master-key.ts';
import { gracefulShutdown } from './shutdown.ts';
import { readServerVersion } from './version.ts';

/** The sign-in helper MWC_LOGIN_HELPER names (`processes/login-helper/port.ts`). */
type LoginHelper = NonNullable<ReturnType<typeof loginHelperFromConfig>>;

/** `serve()` of `@hono/node-server`, narrowed to what `start` uses. */
export type Serve = (
  options: {
    fetch: (request: Request) => Response | Promise<Response>;
    port: number;
    hostname: string;
    /** Completes the WebSocket handshakes the app's socket routes accept (the runners' sockets). */
    websocket: { server: WebSocketServer };
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
  /** The master keys that seal subscriptions: MWC_MASTER_KEY, the development `.data/master.key`, or (tests) memory. */
  loadKeyring(config: Config, logger: Logger): Promise<Keyring>;
  readVersion(): string;
  /** The sign-in helper MWC_LOGIN_HELPER names (`loginHelperFromConfig`); swept once the server listens. */
  loginHelper(config: Config, logger: Logger): LoginHelper | undefined;
  /** The server's own power driver MWC_LOCAL_POWER asks for (`localPowerFromConfig`), or none; it logs one line. */
  localPower(config: Config, logger: Logger): LocalPower | undefined;
  serve: Serve;
  /** Registers a signal handler: `process.on`. */
  onSignal(signal: 'SIGTERM' | 'SIGINT', handler: (signal: string) => void): void;
  /** `process.exit`. */
  exit(code: number): void;
  /** The jobs loop's timers (MWC_JOBS=on); tests fire them by hand. */
  readonly timers: Timers;
}

const SYSTEM: StartDeps = {
  openDb: (config, logger) =>
    createDb(config.DATABASE_URL, {
      onnotice: (notice) => logger.debug({ notice: notice.message, code: notice.code }, 'postgres notice'),
    }),
  dbLabel: 'postgres',
  migrate: false,
  createLogger: (config) => createLogger(config),
  loadKeyring: (config, logger) => loadKeyring(config, { dataDir: DEV_DATA_DIR, logger }),
  readVersion: () => readServerVersion(),
  loginHelper: (config, logger) => loginHelperFromConfig(config, logger),
  localPower: (config, logger) => localPowerFromConfig(config, logger),
  serve: (options, onListening) =>
    nodeServe(options as Parameters<typeof nodeServe>[0], onListening) as Server,
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  exit: (code) => process.exit(code),
  timers: SYSTEM_TIMERS,
};

export interface Started {
  readonly config: Config;
  readonly logger: Logger;
  readonly version: string;
  readonly db: DbHandle;
  readonly app: ReturnType<typeof createApp>;
  readonly server: Server;
  /** The jobs loop, running from the moment the server listens; undefined with MWC_JOBS=off. */
  readonly jobs: JobsRunner | undefined;
  /**
   * The SIGTERM/SIGINT handler: stop listening, the jobs, the sign-ins in progress (their sandboxes killed) and the
   * devboxes' tunnels this server holds, let requests finish, close the database, exit.
   */
  readonly shutdown: (signal: string) => Promise<void>;
}

/**
 * The jobs loop on the app's database, provider, clock, runner hub and power control (the power scheduler drives the
 * devboxes through it), with the advisory lock; undefined when MWC_JOBS=off.
 */
function jobsRunner(server: Parameters<typeof moduleJobs>[0], timers: Timers): JobsRunner | undefined {
  if (!server.config.MWC_JOBS) return undefined;
  return createJobsRunner({
    db: server.db,
    clock: server.clock,
    logger: server.logger,
    identity: server.identity,
    work: moduleJobs(server),
    reconcileIntervalMs: server.config.MWC_RECONCILE_MINUTES * 60_000,
    lock: advisoryJobsLock(server.db),
    timers,
  });
}

/**
 * The app and the jobs loop on one runner hub and one power control (`machinesRuntime`: this server's own driver when
 * it has one), and what the shutdown stops before the database closes: the hub, the devboxes' tunnels and the sign-ins
 * in progress.
 */
function compose(server: ServerDeps, deps: StartDeps, keyring: Keyring, local: LocalPower | undefined) {
  const stops: (() => Promise<void>)[] = [];
  const onShutdown = (stop: () => Promise<void>) => void stops.push(stop);
  const machines = machinesRuntime({ ...server, onShutdown }, local);
  const jobs = jobsRunner(
    { ...server, hub: machines.runnerHub, control: machines.powerControl },
    deps.timers,
  );
  const loginHelper = deps.loginHelper(server.config, server.logger);
  const app = createApp({ ...server, keyring, jobs: jobs ?? JOBS_OFF, loginHelper, onShutdown, ...machines });
  return { app, jobs, loginHelper, stops };
}

/** The database, with the migrations applied first when MWC_MIGRATE_ON_START (or `migrate`) says so. */
async function openDatabase(deps: StartDeps, config: Config, logger: Logger): Promise<DbHandle> {
  const db = await deps.openDb(config, logger);
  if (deps.migrate || config.MWC_MIGRATE_ON_START) {
    logger.info({ db: deps.dbLabel }, 'applying migrations');
    await migrateToLatest(db);
  }
  return db;
}

/**
 * Once the server listens: removes the sign-in sandboxes an earlier server on its port left running (a crash, a kill),
 * and says how many. A sweep that fails is a warning, never a stop.
 */
async function sweepSandboxes(helper: LoginHelper, logger: Logger): Promise<void> {
  try {
    const removed = await helper.sweep();
    if (removed > 0)
      logger.info({ helper: helper.mode, removed }, 'removed sign-in sandboxes a stopped server left');
  } catch (error) {
    logger.warn({ err: error }, 'could not sweep the sign-in sandboxes');
  }
}

/**
 * Says why sign-in is off when a Clerk secret key is set but is not one (a placeholder, a half-pasted key) and
 * MWC_IDENTITY did not ask for clerk: the variable's name only, never its value.
 */
function warnIgnoredSecretKey(
  env: Readonly<Record<string, string | undefined>>,
  config: Config,
  logger: Logger,
) {
  if (!env.CLERK_SECRET_KEY || env.MWC_IDENTITY || config.MWC_IDENTITY !== 'none') return;
  logger.warn(
    { variable: 'CLERK_SECRET_KEY' },
    'CLERK_SECRET_KEY is set but does not look like sk_test_... or sk_live_...; sign-in stays off',
  );
}

/**
 * The API server's startup, all of what `main.ts` runs: the configuration from `env` (a `ConfigError` listing every
 * problem when it is invalid, before anything is opened), the logger, the master keyring, the server's own power driver
 * (MWC_LOCAL_POWER), the database, the migrations when MWC_MIGRATE_ON_START (or `migrate`) says so, the chat turns a
 * stopped server left running failed, the app, the listening server, the jobs loop (MWC_JOBS), the sweep of the sign-in
 * sandboxes a stopped server left, and the graceful shutdown on SIGTERM and SIGINT, which ends the sign-ins in progress
 * and the devboxes' tunnels. A server error (the port is taken) exits 1.
 */
export async function start(
  env: Readonly<Record<string, string | undefined>>,
  overrides: Partial<StartDeps> = {},
): Promise<Started> {
  const deps: StartDeps = { ...SYSTEM, ...overrides };
  const config = loadConfig({ ...env });
  const logger = await deps.createLogger(config);
  warnIgnoredSecretKey(env, config, logger);
  // Before the database: a key file that is not a key stops the start with nothing opened.
  const keyring = await deps.loadKeyring(config, logger);
  const local = deps.localPower(config, logger); // MWC_LOCAL_POWER=on without the tools stops here too
  const version = deps.readVersion();
  const db = await openDatabase(deps, config, logger);

  // One provider for the routes and the jobs (the Clerk connector keeps its invitation rate window in memory).
  const identity = identityFromConfig(config);
  const webDist = config.MWC_WEB_DIST ? { webDist: config.MWC_WEB_DIST } : {};
  const serverDeps: ServerDeps = {
    db,
    config,
    logger,
    version,
    clock: () => new Date(),
    identity,
    ...webDist,
  };
  await reapTurns(serverDeps); // before listening: the turns an earlier server left running fail
  const { app, jobs, loginHelper, stops } = compose(serverDeps, deps, keyring, local);
  const websocket = { server: createSocketServer() };
  const server = deps.serve(
    { fetch: app.fetch, port: config.MWC_PORT, hostname: config.MWC_HOST, websocket },
    (info) => {
      const line = { host: config.MWC_HOST, port: info.port, version, db: deps.dbLabel };
      logger.info({ ...line, identity: config.MWC_IDENTITY, jobs: jobs !== undefined }, 'listening');
      // Only now: a server that could not take the port must not remove the sandboxes of the one holding it.
      if (loginHelper) void sweepSandboxes(loginHelper, logger);
    },
  );
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'server error');
    deps.exit(1);
  });

  jobs?.start();

  const stopJobs = jobs ? { stopJobs: () => jobs.stop() } : {};
  const shutdown = gracefulShutdown({
    server,
    closeDb: () => db.close(),
    stopModules: () => Promise.all(stops.map((stop) => stop())),
    logger,
    exit: deps.exit,
    ...stopJobs,
  });
  deps.onSignal('SIGTERM', shutdown);
  deps.onSignal('SIGINT', shutdown);
  return { config, logger, version, db, app, server, jobs, shutdown };
}
