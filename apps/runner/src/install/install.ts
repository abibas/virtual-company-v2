import { dirname, join, resolve } from 'node:path';
import type { RunnerPtyTarget } from '@mwc/shared/runner-protocol';
import { readRunnerConfig, runnerConfigPath } from '../config.ts';
import { EXIT } from '../daemon/start.ts';
import { ptyPackage, ptyTarget } from '../terminal/loader.ts';
import { enrolledText } from './enroll/commands.ts';
import { type EnrollInput, enrollMachine, httpBase, viaOf } from './enroll/enroll.ts';
import { machineKind } from './enroll/facts.ts';
import { CommandError, type Host, homeOf } from './host.ts';
import { installedBundle } from './paths.ts';
import { serviceManager } from './service.ts';

/**
 * `mwc-runner install`: enrolls the machine when given a token (else keeps the enrollment it has: a reinstall, which
 * install.sh runs with `--server` alone, the server the machine is enrolled on; `--via`, when given, is the address
 * this install reaches the server at, for install.sh's downloads and the enroll, while `--server` is the one saved for
 * the runner), copies the runner it runs from (the downloaded `runner.mjs`) to `~/.local/share/mwc-runner/runner.mjs` with the terminal's PTY that
 * install.sh unpacked beside it (`node_modules/`), and runs that as a service: a launchd agent on macOS, a systemd user
 * unit on Linux. Everything that can refuse is checked before the token is used.
 */

/** Refusals that need no enrollment: the system, a container, a runner run from its sources. */
function checkFirst(host: Host): void {
  if (machineKind(host) === 'container') {
    throw new CommandError(
      "in a container the runner is the container's main process (deploy/Dockerfile.runner); it needs no service",
    );
  }
  if (!host.selfPath.endsWith('.mjs')) {
    throw new CommandError(
      'install copies the runner it runs from: run it from the built runner.mjs (pnpm --filter @mwc/runner build)',
    );
  }
}

/**
 * The enrollment: a new one with a token, else the configuration this machine has; `--server` without a token must be
 * the server it is enrolled on (a reinstall from install.sh).
 */
async function enrollment(host: Host, input: EnrollInput): Promise<string> {
  if (input.token !== undefined) return enrolledText(await enrollMachine(host, input));
  viaOf(input.via);
  const configPath = runnerConfigPath(host.env);
  let config: ReturnType<typeof readRunnerConfig>;
  try {
    config = readRunnerConfig(configPath);
  } catch (error) {
    throw new CommandError(
      `${(error as Error).message}; give --server and --token to enroll it`,
      EXIT.config,
    );
  }
  if (input.server !== undefined && httpBase(input.server) !== httpBase(config.serverUrl)) {
    throw new CommandError(
      `this machine is enrolled on ${config.serverUrl}, not ${input.server}; give --token to enroll it there`,
      EXIT.usage,
    );
  }
  return `Keeping the enrollment as "${config.name}", machine ${config.machineId}, on ${config.serverUrl}.\n`;
}

/** The PTY of a system beside a runner in `dir`: `<dir>/node_modules/@lydell/node-pty-<target>`. */
export const ptyBeside = (dir: string, target: RunnerPtyTarget): string =>
  join(dir, 'node_modules', ptyPackage(target));

/**
 * The terminal's PTY goes beside the installed runner, replacing what was there: the one install.sh unpacked beside the
 * downloaded runner, or none (the terminal stays off). A runner reinstalled from its installed copy keeps its own.
 * Returns what to tell the person.
 */
function installPty(host: Host, bundle: string): string {
  const target = ptyTarget(host.platform, host.arch);
  if (target === undefined) {
    return `warning: no terminal on ${host.platform}-${host.arch}: no PTY is built for it\n`;
  }
  const from = dirname(resolve(host.selfPath));
  const to = dirname(bundle);
  const installed = ptyBeside(to, target);
  if (from !== to) {
    host.fs.remove(join(to, 'node_modules'));
    if (host.fs.exists(ptyBeside(from, target))) host.fs.copyTree(ptyBeside(from, target), installed);
  }
  if (host.fs.exists(installed)) return `The terminal's PTY (${target}) is in ${installed}.\n`;
  return "warning: the terminal's PTY did not come with this runner (install.sh downloads it); no terminal here\n";
}

/** `mwc-runner install [--server <url> [--via <url>] --token <mwc_et_…> [--name <name>] [--slots <n>] [--force]]`. */
export async function installCommand(host: Host, input: EnrollInput): Promise<number> {
  const manager = serviceManager(host);
  checkFirst(host);
  host.out(await enrollment(host, input));
  const bundle = installedBundle(host.env, homeOf(host));
  host.fs.mkdir(dirname(bundle), 0o755);
  if (resolve(host.selfPath) !== bundle) host.fs.copyFile(host.selfPath, bundle);
  const pty = installPty(host, bundle);
  const warnings = await manager.install();
  host.out(`Installed the runner in ${bundle} and started it as a ${manager.name} (${manager.file}).\n`);
  host.out(pty);
  for (const warning of warnings) host.out(`warning: ${warning}\n`);
  host.out(`Check it with: ${host.execPath} ${bundle} status\nIts log: ${manager.logs}\n`);
  return 0;
}
