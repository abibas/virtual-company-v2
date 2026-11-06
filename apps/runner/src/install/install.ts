import { dirname, resolve } from 'node:path';
import { readRunnerConfig, runnerConfigPath } from '../config.ts';
import { enrolledText } from '../enroll/commands.ts';
import { type EnrollInput, enrollMachine } from '../enroll/enroll.ts';
import { machineKind } from '../enroll/facts.ts';
import { EXIT } from '../start.ts';
import { CommandError, type Host, homeOf } from './host.ts';
import { installedBundle } from './paths.ts';
import { serviceManager } from './service.ts';

/**
 * `mwc-runner install`: enrolls the machine when given a token (else keeps the enrollment it has), copies the runner it
 * runs from (the downloaded `runner.mjs`) to `~/.local/share/mwc-runner/runner.mjs`, and runs that as a service: a
 * launchd agent on macOS, a systemd user unit on Linux. Everything that can refuse is checked before the token is used.
 */

/** Refusals that need no enrollment: the system, a container, a runner run from its sources, the options. */
function checkFirst(host: Host, input: EnrollInput): void {
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
  if (input.token === undefined && input.server !== undefined) {
    throw new CommandError(
      '--server goes with --token (to reinstall with the enrollment this machine has, give neither)',
      EXIT.usage,
    );
  }
}

/** The enrollment: a new one with a token, else the configuration this machine has. */
async function enrollment(host: Host, input: EnrollInput): Promise<string> {
  if (input.token !== undefined) return enrolledText(await enrollMachine(host, input));
  const configPath = runnerConfigPath(host.env);
  try {
    const config = readRunnerConfig(configPath);
    return `Keeping the enrollment as "${config.name}", machine ${config.machineId}, on ${config.serverUrl}.\n`;
  } catch (error) {
    throw new CommandError(
      `${(error as Error).message}; give --server and --token to enroll it`,
      EXIT.config,
    );
  }
}

/** `mwc-runner install [--server <url> --token <mwc_et_…> [--name <name>] [--slots <n>] [--force]]`. */
export async function installCommand(host: Host, input: EnrollInput): Promise<number> {
  const manager = serviceManager(host);
  checkFirst(host, input);
  host.out(await enrollment(host, input));
  const bundle = installedBundle(host.env, homeOf(host));
  host.fs.mkdir(dirname(bundle), 0o755);
  if (resolve(host.selfPath) !== bundle) host.fs.copyFile(host.selfPath, bundle);
  const warnings = await manager.install();
  host.out(`Installed the runner in ${bundle} and started it as a ${manager.name} (${manager.file}).\n`);
  for (const warning of warnings) host.out(`warning: ${warning}\n`);
  host.out(`Check it with: ${host.execPath} ${bundle} status\nIts log: ${manager.logs}\n`);
  return 0;
}
