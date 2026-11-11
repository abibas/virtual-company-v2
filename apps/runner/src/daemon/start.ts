import { CONTAINER_WORK_ROOT } from '@mwc/shared/runner-protocol';
import {
  isShared,
  type RunnerConfig,
  readRunnerConfig,
  runnerConfigPath,
  runnerStateDir,
  writeRunnerConfig,
} from '../config.ts';
import { caffeinateDriver } from '../hold/caffeinate.ts';
import { devboxDriver } from '../hold/devbox.ts';
import { detectHoldDriver, type HoldDriver, type HoldDriverKind, noneDriver } from '../hold/driver.ts';
import type { LinkEnd } from '../link/link.ts';
import { inContainer, machineSampler } from '../stats/machine.ts';
import type { MainDeps } from '../system/deps.ts';
import { createLog, type Log } from '../system/log.ts';
import { harnessHost } from '../turns/drivers.ts';
import { type HealthServer, healthPort, startHealthServer } from './health.ts';
import { createRunner, type Runner, type RunnerOptions } from './runner.ts';

export type { MainDeps } from '../system/deps.ts';

/**
 * `mwc-runner run` (`@mwc/runner/start`): reads the configuration, makes the state folder, picks the hold driver,
 * starts the runner and the health endpoint, and stops gracefully on SIGTERM or SIGINT (the socket closed, the hold
 * released). A refused key and a runner too old stop the process with their own exit codes, so the service manager
 * shows why; a replaced connection keeps it idle; an update in place stops it with the code its service manager restarts
 * it after. `main.ts` calls it with the real process (`system/node.ts`, the shape in `system/deps.ts`).
 */

/** The exit codes (sysexits where one fits). */
export const EXIT = {
  ok: 0,
  usage: 64,
  /** The server needs a newer runner (4003; EX_PROTOCOL). */
  tooOld: 76,
  /** The server refused the runner key (HTTP 401 or 4001; EX_NOPERM). */
  unauthorized: 77,
  /** The configuration file or an environment variable is wrong (EX_CONFIG). */
  config: 78,
  /**
   * The runner updated itself and stops to start again on the new build (EX_TEMPFAIL): systemd's `Restart=always`
   * restarts any exit but 76–78, and launchd's `KeepAlive {SuccessfulExit: false}` restarts any exit but 0.
   */
  restart: 75,
} as const;

interface Setup {
  readonly config: RunnerConfig;
  readonly configPath: string;
  readonly stateDir: string;
  readonly hold: HoldDriverKind;
  readonly port: number;
}

/** Reads and checks everything that can be wrong before the runner starts; a message for each problem. */
function setUp(deps: MainDeps, log: Log): Setup {
  const configPath = runnerConfigPath(deps.env);
  const config = readRunnerConfig(configPath);
  if (isShared(configPath))
    log.warn('the runner configuration is readable by others; chmod 600 it', { configPath });
  const stateDir = runnerStateDir(deps.env);
  deps.fs.mkdir(stateDir);
  const hold = detectHoldDriver({
    platform: deps.platform,
    exists: deps.fs.exists,
    override: deps.env.MWC_RUNNER_HOLD,
  });
  return { config, configPath, stateDir, hold, port: healthPort(deps.env) };
}

/** The driver of a hold kind. */
export function holdDriverFor(kind: HoldDriverKind, deps: MainDeps, log: Log): HoldDriver {
  if (kind === 'devbox_keepalive') {
    return devboxDriver({
      spawn: deps.spawn,
      readFile: deps.fs.readFile,
      clock: deps.clock,
      timers: deps.timers,
      log,
    });
  }
  if (kind === 'caffeinate') return caffeinateDriver({ spawn: deps.spawn, pid: deps.pid, log });
  return noneDriver();
}

/** The terminal's PTY, or why there is none (logged either way). */
function loadTerminal(deps: MainDeps, home: string, log: Log): RunnerOptions['terminal'] {
  const pty = deps.loadPty();
  if (!pty.ok) {
    log.warn('no terminal on this machine', { reason: pty.reason });
    return undefined;
  }
  log.info('terminal ready', { pty: pty.target });
  return { spawn: pty.spawn, env: deps.env, home, platform: deps.platform, exists: deps.fs.exists };
}

function makeRunner(deps: MainDeps, setup: Setup, log: Log): Runner {
  const { clock, timers } = deps;
  const home = deps.env.HOME || deps.os.homedir();
  const terminal = loadTerminal(deps, home, log);
  return createRunner({
    config: setup.config,
    version: deps.version,
    ...(deps.claudeVersion === undefined ? {} : { claudeVersion: deps.claudeVersion }),
    ...(deps.build === undefined ? {} : { build: deps.build }),
    builtAt: deps.builtAt ?? null,
    ...(deps.update ? { update: deps.update } : {}),
    ...(deps.containerId ? { containerId: deps.containerId } : {}),
    log,
    hold: holdDriverFor(setup.hold, deps, log),
    sampler: machineSampler(deps, home, log),
    ...(deps.power ? { power: deps.power } : {}),
    ...(deps.tools ? { tools: deps.tools } : {}),
    processes: { spawn: deps.spawn, killGroup: deps.killGroup },
    ...(terminal ? { terminal } : {}),
    // In a container its folders are only those of its work volume.
    folders: { fs: deps.foldersFs, home, root: inContainer(deps) ? CONTAINER_WORK_ROOT : null },
    harness: harnessHost(
      {
        clis: deps.harnesses ?? {},
        env: deps.env,
        fs: deps.privateFs,
        stateDir: setup.stateDir,
        find: deps.findHarness,
        tools: deps.toolServer,
        artifacts: deps.artifactsFs,
      },
      log,
    ),
    saveConfig: (next) => writeRunnerConfig(setup.configPath, next),
    clock,
    timers,
    random: deps.random,
    WebSocket: deps.WebSocket,
  });
}

/** What the runner says when its link ends for good, and the exit code; undefined when the process stays. */
function onEnd(end: LinkEnd, version: string, log: Log): number | undefined {
  if (end.reason === 'unauthorized') {
    log.error('the server refused the runner key (revoked, or the machine was removed); enroll it again', {
      code: end.code,
    });
    return EXIT.unauthorized;
  }
  if (end.reason === 'too_old') {
    log.error('this runner is older than the server takes; update it', {
      version,
      minRunnerVersion: end.hello?.minRunnerVersion,
    });
    return EXIT.tooOld;
  }
  if (end.reason === 'replaced') {
    log.warn(
      'a newer connection of this machine replaced this one; not reconnecting until the runner restarts',
    );
  }
  return undefined;
}

/** Starts the health endpoint; without it (its port taken) the runner goes on. */
async function startHealth(runner: Runner, port: number, log: Log): Promise<HealthServer | undefined> {
  try {
    const health = await startHealthServer(port, () => runner.status());
    log.info('health endpoint listening', { url: `http://127.0.0.1:${health.port}/healthz` });
    return health;
  } catch (error) {
    log.error('the health endpoint cannot listen; going on without it', { port, error });
    return undefined;
  }
}

/**
 * Waits for SIGTERM or SIGINT (exit 0), a link that ends for good (its exit code) or an update in place (`EXIT.restart`),
 * then stops the runner and the health endpoint once, however many of those come. A replaced link keeps the process
 * alive until a signal.
 */
function untilStopped(
  runner: Runner,
  health: HealthServer | undefined,
  deps: MainDeps,
  log: Log,
): Promise<number> {
  let release: (() => void) | undefined;
  let stopping: Promise<number> | undefined;
  const shutdown = (code: number) => {
    stopping ??= (async () => {
      release?.();
      await runner.stop();
      await health?.close();
      log.info('stopped', { code });
      return code;
    })();
    return stopping;
  };
  return new Promise<number>((resolve) => {
    const onSignal = (signal: string) => {
      if (stopping) return;
      log.info('stopping', { signal });
      resolve(shutdown(EXIT.ok));
    };
    deps.onSignal('SIGTERM', () => onSignal('SIGTERM'));
    deps.onSignal('SIGINT', () => onSignal('SIGINT'));
    void runner.ended.then((end) => {
      const exitCode = onEnd(end, deps.version, log);
      if (exitCode !== undefined) resolve(shutdown(exitCode));
      else if (end.reason === 'replaced') release = deps.keepAlive();
    });
    void runner.restart.then(() => {
      if (stopping) return;
      log.info('restarting on the updated runner', { code: EXIT.restart });
      resolve(shutdown(EXIT.restart));
    });
  });
}

/** Runs `mwc-runner <argv>` and exits with its code (also returned). */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  const log = createLog(
    (line) => deps.write(line),
    () => deps.clock.now(),
  );
  const finish = (code: number) => {
    deps.exit(code);
    return code;
  };
  if (argv.length !== 1 || argv[0] !== 'run') {
    log.error('usage: mwc-runner run');
    return finish(EXIT.usage);
  }
  let setup: Setup;
  try {
    setup = setUp(deps, log);
  } catch (error) {
    log.error((error as Error).message);
    return finish(EXIT.config);
  }
  const { config, configPath, stateDir, hold } = setup;
  const { machineId, name, serverUrl: server } = config;
  const self = {
    version: deps.version,
    builtAt: deps.builtAt ?? null,
    build: deps.build ?? null,
    selfUpdate: deps.update?.manager ?? false,
  };
  log.info('starting', { ...self, machineId, name, server, hold, configPath, stateDir });
  const runner = makeRunner(deps, setup, log);
  runner.start();
  const health = await startHealth(runner, setup.port, log);
  return finish(await untilStopped(runner, health, deps, log));
}
