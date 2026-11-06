import { dirname, join } from 'node:path';
import { runnerStateDir } from '../config.ts';
import { CommandError, failure, type Host, homeOf } from './host.ts';
import { type EnvEntry, LAUNCHD_LABEL, launchdPlistPath, type ServiceSpec, serviceSpec } from './paths.ts';
import type { ServiceManager } from './service.ts';

/**
 * The runner as a launchd agent on macOS: `~/Library/LaunchAgents/com.mwc.runner.plist`, loaded into the user's GUI
 * session with `launchctl bootstrap gui/<uid>`, started at load and kept alive, its output in the state folder's
 * `runner.log`. launchd has no way to leave a service stopped after some exit codes (systemd's
 * `RestartPreventExitStatus`), so the plist restarts the runner only when it fails, and under launchd the runner exits 0
 * after a refused key, a runner too old or a broken configuration (`cli.ts`), instead of starting again every 10 s.
 */

export const LAUNCHCTL = '/bin/launchctl';

/** Tells the runner which service manager runs it (`cli.ts`). */
export const SERVICE_MANAGER_ENV = 'MWC_RUNNER_SERVICE';

/** How often `install` tries `launchctl bootstrap` (a service just booted out may still be stopping). */
export const BOOTSTRAP_TRIES = 3;
export const BOOTSTRAP_RETRY_MS = 1000;

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const string = (value: string) => `<string>${escapeXml(value)}</string>`;

/** The agent's plist: `node <bundle> run` with the spec's environment, at load and kept alive, logs in `logFile`. */
export function renderPlist(spec: ServiceSpec, logFile: string): string {
  const env = spec.env.flatMap(([name, value]) => [
    `    <key>${escapeXml(name)}</key>`,
    `    ${string(value)}`,
  ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${string(LAUNCHD_LABEL)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[spec.node, spec.bundle, 'run'].map((arg) => `    ${string(arg)}`),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...env,
    '  </dict>',
    '  <key>WorkingDirectory</key>',
    `  ${string(spec.home)}`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>10</integer>',
    '  <key>StandardOutPath</key>',
    `  ${string(logFile)}`,
    '  <key>StandardErrorPath</key>',
    `  ${string(logFile)}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** A launchctl command: the program and its arguments. */
export type Command = readonly [file: string, args: readonly string[]];

/** The launchctl commands for the user `uid`: load the plist into the GUI session, or unload the agent. */
export function launchctlCommands(uid: number, plist: string): { bootstrap: Command; bootout: Command } {
  const domain = `gui/${uid}`;
  return {
    bootstrap: [LAUNCHCTL, ['bootstrap', domain, plist]],
    bootout: [LAUNCHCTL, ['bootout', `${domain}/${LAUNCHD_LABEL}`]],
  };
}

/** The environment launchd gives the runner besides its PATH: which service manager runs it. */
export const LAUNCHD_ENV: readonly EnvEntry[] = [[SERVICE_MANAGER_ENV, 'launchd']];

export function launchdManager(host: Host): ServiceManager {
  const home = homeOf(host);
  const file = launchdPlistPath(home);
  const logFile = join(runnerStateDir(host.env), 'runner.log');
  const commands = launchctlCommands(host.uid, file);
  const run = ([program, args]: Command) => host.exec(program, args);
  return {
    name: 'launchd agent',
    file,
    logs: `tail -f ${logFile}`,
    async install() {
      const replaced = host.fs.exists(file);
      host.fs.mkdir(dirname(file), 0o755);
      host.fs.mkdir(dirname(logFile), 0o700);
      host.fs.writeFile(file, renderPlist(serviceSpec(host, LAUNCHD_ENV), logFile), 0o644);
      // The agent already loaded runs the old bundle: unload it first (it is not loaded when this fails).
      if (replaced) await run(commands.bootout);
      for (let attempt = 1; ; attempt++) {
        const result = await run(commands.bootstrap);
        if (result.code === 0) return [];
        if (attempt === BOOTSTRAP_TRIES) {
          throw new CommandError(
            `launchctl could not load ${file} into your login session (gui/${host.uid}): ${failure(result)}. ` +
              'Run the install from a Terminal of your own desktop session.',
          );
        }
        await run(commands.bootout);
        await host.sleep(BOOTSTRAP_RETRY_MS);
      }
    },
    async remove() {
      if (!host.fs.exists(file)) return;
      await run(commands.bootout);
      host.fs.remove(file);
    },
  };
}
