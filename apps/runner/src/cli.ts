import { parseArgs } from 'node:util';
import { runnerConfigPath } from './config.ts';
import { EXIT, type MainDeps, main } from './daemon/start.ts';
import { enrollCommand, enrollOnFirstBoot } from './install/enroll/commands.ts';
import { harnessClis } from './install/enroll/facts.ts';
import { CommandError, type Env, type Host } from './install/host.ts';
import { installCommand } from './install/install.ts';
import { SERVICE_MANAGER_ENV } from './install/launchd.ts';
import { statusCommand } from './install/status.ts';
import { PERMANENT_EXIT_CODES } from './install/systemd.ts';
import { uninstallCommand } from './install/uninstall.ts';
import { createLog, type Log } from './system/log.ts';
import { runnerBuiltAt } from './system/version.ts';
import { runnerBuild, updateTarget } from './update/build.ts';
import { selfUpdater } from './update/self-update.ts';

/**
 * `mwc-runner <command>` (`node runner.mjs <command>`): the daemon (`run`, what the service starts) and the commands a
 * person runs on the machine: `enroll`, `install`, `status`, `uninstall`. `main.ts` calls it with the real process.
 */

export interface CliDeps {
  /** The daemon's process (`system/node.ts`), made for `run` only. */
  daemon(): MainDeps;
  /** The machine (`install/system.ts`), for every command and a container's first start. */
  host(): Host;
}

export const HELP = `usage: mwc-runner <command>   (node runner.mjs <command>)
  run                       the runner itself, as its service starts it
  enroll --server URL --token mwc_et_… [--name NAME] [--slots N] [--force]
                            enroll this machine: its id and runner key go to ~/.config/mwc/runner.json
  install [--server URL [--via URL] [--token mwc_et_… [--name NAME] [--slots N] [--force]]]
                            enroll (with a token; without one, keep the enrollment on that server), copy this
                            runner and its terminal's PTY to ~/.local/share/mwc-runner and run it as a service:
                            a launchd agent on macOS, a systemd user unit on Linux; --via is the address this
                            install reaches the server at (install.sh's downloads, the enroll), --server the
                            one the runner keeps
  status                    the enrollment, the service and what the running runner says
  uninstall [--purge]       stop and remove the service and the installed runner; --purge also removes
                            the configuration (the runner key) and the state folder
`;

const OPTIONS = {
  server: { type: 'string' },
  via: { type: 'string' },
  token: { type: 'string' },
  name: { type: 'string' },
  slots: { type: 'string' },
  force: { type: 'boolean' },
  purge: { type: 'boolean' },
} as const;

type Option = keyof typeof OPTIONS;
const ENROLL_OPTIONS: readonly Option[] = ['server', 'token', 'name', 'slots', 'force'];

/** The options each command takes. */
export const COMMAND_OPTIONS: Readonly<Record<string, readonly Option[]>> = {
  enroll: ENROLL_OPTIONS,
  install: [...ENROLL_OPTIONS, 'via'],
  status: [],
  uninstall: ['purge'],
};

type Values = { -readonly [K in Option]?: (typeof OPTIONS)[K]['type'] extends 'string' ? string : boolean };

/** A command's options, or a usage CommandError (an unknown option, a missing value, a stray word). */
export function parseOptions(command: string, args: readonly string[]): Values {
  const options = Object.fromEntries((COMMAND_OPTIONS[command] ?? []).map((name) => [name, OPTIONS[name]]));
  try {
    return parseArgs({ args: [...args], options, strict: true, allowPositionals: false }).values as Values;
  } catch (error) {
    throw new CommandError(`${(error as Error).message}\n${HELP}`, EXIT.usage);
  }
}

/**
 * The exit under a service manager: launchd restarts whatever does not exit 0, so a permanent stop (a refused key, a
 * runner too old, a broken configuration) exits 0 there, logged, and the runner stays stopped until it is installed
 * again. Elsewhere the code is the code (systemd's unit leaves those stopped by itself).
 */
export function serviceExit(env: Env, exit: (code: number) => void, log: Log): (code: number) => void {
  return (code) => {
    if (env[SERVICE_MANAGER_ENV] === 'launchd' && PERMANENT_EXIT_CODES.includes(code)) {
      log.warn('exiting 0 so launchd leaves the runner stopped; fix the cause, then run install again', {
        code,
      });
      exit(EXIT.ok);
      return;
    }
    exit(code);
  };
}

/**
 * What the daemon learns about itself once, at start: the build it runs, when that was built (the `runner.json` beside
 * it) and, for an installed copy, its self-update.
 */
export function selfFacts(host: Host): Pick<MainDeps, 'build' | 'builtAt' | 'update'> {
  const target = updateTarget(host);
  const update = target === undefined ? undefined : selfUpdater({ target, fetch: host.fetch, fs: host.fs });
  const builtAt = runnerBuiltAt(host.selfPath, (path) => host.fs.readFile(path));
  return { build: runnerBuild(host), builtAt, ...(update ? { update } : {}) };
}

/**
 * `run`: a container enrolls itself on its first start; then the daemon, with the harnesses' CLIs (each asked
 * `--version` once; Claude Code's is also the hello's `claudeVersion`), its build and its self-update for its hello.
 */
async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const daemon = deps.daemon();
  if (argv.length !== 1) return main(argv, daemon);
  const host = deps.host();
  const log = createLog(
    (line) => daemon.write(line),
    () => daemon.clock.now(),
  );
  const exit = serviceExit(host.env, daemon.exit, log);
  const failed = await enrollOnFirstBoot(host, runnerConfigPath(host.env), log);
  if (failed !== undefined) {
    exit(failed);
    return failed;
  }
  const harnesses = await harnessClis(host);
  const claudeVersion = harnesses.claude_code?.version ?? null;
  return main(argv, { ...daemon, harnesses, claudeVersion, ...selfFacts(host), exit });
}

/** One of the commands a person runs; its message on stderr and its exit code when it fails. */
async function command(name: string, args: readonly string[], host: Host): Promise<number> {
  try {
    const values = parseOptions(name, args);
    if (name === 'enroll') return await enrollCommand(host, values);
    if (name === 'install') return await installCommand(host, values);
    if (name === 'status') return await statusCommand(host);
    return await uninstallCommand(host, values);
  } catch (error) {
    host.err(`mwc-runner ${name}: ${(error as Error).message}\n`);
    return error instanceof CommandError ? error.code : 1;
  }
}

/** Runs `mwc-runner <argv>`; returns the exit code (`run` exits by itself when it stops). */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [name, ...args] = argv;
  if (name === 'run') return run(argv, deps);
  const host = deps.host();
  if (name !== undefined && Object.hasOwn(COMMAND_OPTIONS, name)) return command(name, args, host);
  if (name === undefined || name === 'help' || name === '--help') {
    host.out(HELP);
    return EXIT.ok;
  }
  host.err(`mwc-runner: unknown command ${name}\n${HELP}`);
  return EXIT.usage;
}
