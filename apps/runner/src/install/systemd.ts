import { dirname } from 'node:path';
import { EXIT } from '../start.ts';
import { CommandError, type ExecResult, failure, type Host, homeOf, unixUser } from './host.ts';
import { type ServiceSpec, SYSTEMD_UNIT, serviceSpec, systemdUnitPath } from './paths.ts';
import type { ServiceManager } from './service.ts';

/**
 * The runner as a systemd user unit on Linux: `~/.config/systemd/user/mwc-runner.service`, enabled and started with
 * `systemctl --user`, restarted 10 s after it stops except after the runner's permanent exits (76 too old, 77 key
 * refused, 78 configuration), with lingering so it runs while nobody is logged in (the devbox is reached by SSH only).
 * Its log is the user journal.
 */

/** Restarted after any stop but these exit codes (`start.ts`'s `EXIT`), which need a person. */
export const PERMANENT_EXIT_CODES: readonly number[] = [EXIT.tooOld, EXIT.unauthorized, EXIT.config];

/** One word of `ExecStart=` in double quotes: backslash and quote escaped, `%` and `$` doubled (no expansion). */
export function quoteExecArg(arg: string): string {
  return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$$$')}"`;
}

/** One `Environment=` assignment in double quotes (`%` doubled; systemd does not expand `$` there). */
export function quoteEnvironment(name: string, value: string): string {
  return `"${`${name}=${value}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}

/** The unit: `node <bundle> run` in the home folder with the spec's environment, restarted unless it must not be. */
export function renderUnit(spec: ServiceSpec): string {
  return [
    '[Unit]',
    'Description=Most Wanted Corp runner',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${[spec.node, spec.bundle, 'run'].map(quoteExecArg).join(' ')}`,
    'WorkingDirectory=%h',
    ...spec.env.map(([name, value]) => `Environment=${quoteEnvironment(name, value)}`),
    'Restart=always',
    'RestartSec=10',
    `RestartPreventExitStatus=${PERMANENT_EXIT_CODES.join(' ')}`,
    // SIGTERM to the runner alone, which stops its runs itself; everything left is killed after 90 s.
    'KillMode=mixed',
    'TimeoutStopSec=90',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** A command: the program and its arguments. */
export type Command = readonly [file: string, args: readonly string[]];

/** The commands that install and remove the unit for `user`. */
export function systemdCommands(user: string) {
  const systemctl = (...args: string[]): Command => ['systemctl', ['--user', ...args]];
  return {
    linger: ['loginctl', ['enable-linger', user]] as Command,
    sudoLinger: ['sudo', ['-n', 'loginctl', 'enable-linger', user]] as Command,
    reload: systemctl('daemon-reload'),
    enable: systemctl('enable', '--now', SYSTEMD_UNIT),
    restart: systemctl('restart', SYSTEMD_UNIT),
    disable: systemctl('disable', '--now', SYSTEMD_UNIT),
  };
}

/** Where systemd keeps the user's lingering flag. */
export const lingerFile = (user: string) => `/var/lib/systemd/linger/${user}`;

export function systemdManager(host: Host): ServiceManager {
  const file = systemdUnitPath(host.env, homeOf(host));
  const user = unixUser(host);
  const commands = systemdCommands(user);
  // systemctl --user finds the user's manager through XDG_RUNTIME_DIR, which a bare SSH command may lack.
  const env = { ...host.env, XDG_RUNTIME_DIR: host.env.XDG_RUNTIME_DIR || `/run/user/${host.uid}` };
  const run = ([program, args]: Command) => host.exec(program, args, { env });
  const must = async (command: Command) => {
    const result: ExecResult = await run(command);
    if (result.code !== 0) {
      throw new CommandError(`${command[0]} ${command[1].join(' ')} failed: ${failure(result)}`);
    }
  };
  /** Lingering keeps the user's manager, and the runner, up without a login; a warning when it cannot be had. */
  const linger = async (): Promise<string[]> => {
    if (host.fs.exists(lingerFile(user))) return [];
    if ((await run(commands.linger)).code === 0) return [];
    if ((await run(commands.sudoLinger)).code === 0) return [];
    return [
      `the runner stops when you log out: lingering could not be turned on (run sudo loginctl enable-linger ${user})`,
    ];
  };
  return {
    name: 'systemd user unit',
    file,
    logs: `journalctl --user -u ${SYSTEMD_UNIT} -f`,
    async install() {
      const replaced = host.fs.exists(file);
      host.fs.mkdir(dirname(file), 0o755);
      host.fs.writeFile(file, renderUnit(serviceSpec(host)), 0o644);
      const warnings = await linger();
      await must(commands.reload);
      await must(commands.enable);
      // enable --now leaves a running service as it is: a reinstall restarts it on the new bundle.
      if (replaced) await must(commands.restart);
      return warnings;
    },
    async remove() {
      if (!host.fs.exists(file)) return;
      await run(commands.disable);
      host.fs.remove(file);
      await run(commands.reload);
    },
  };
}
