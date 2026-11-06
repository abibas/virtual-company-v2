import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  quoteEnvironment,
  quoteExecArg,
  renderUnit,
  systemdCommands,
  systemdManager,
} from '../../src/install/systemd.ts';
import { testHost } from '../fixtures/host.ts';

const UNIT = `[Unit]
Description=Most Wanted Corp runner

[Service]
Type=simple
ExecStart="/usr/bin/node" "/home/ihor/.local/share/mwc-runner/runner.mjs" "run"
WorkingDirectory=%h
Environment="PATH=/usr/bin:/bin"
Environment="MWC_RUNNER_STATE_DIR=/var/lib/mwc runner"
Restart=always
RestartSec=10
RestartPreventExitStatus=76 77 78
KillMode=mixed
TimeoutStopSec=90

[Install]
WantedBy=default.target
`;

describe('the systemd user unit', () => {
  it('runs `node <bundle> run` in the home folder, restarted 10 s after a stop but not after 76, 77 or 78', () => {
    const spec = {
      node: '/usr/bin/node',
      bundle: '/home/ihor/.local/share/mwc-runner/runner.mjs',
      env: [
        ['PATH', '/usr/bin:/bin'],
        ['MWC_RUNNER_STATE_DIR', '/var/lib/mwc runner'],
      ] as const,
      home: '/home/ihor',
    };
    expect(renderUnit(spec)).toBe(UNIT);
  });

  it('quotes words so systemd expands nothing in them', () => {
    expect(quoteExecArg('/opt/a b/node')).toBe('"/opt/a b/node"');
    expect(quoteExecArg('a"b\\c%d$e')).toBe('"a\\"b\\\\c%%d$$e"');
    expect(quoteEnvironment('PATH', '/a"b\\c%d$e')).toBe('"PATH=/a\\"b\\\\c%%d$e"');
  });

  it("lingers the user, reloads, enables and starts the unit, and disables it, all as the user's manager", () => {
    expect(systemdCommands('ihor')).toEqual({
      linger: ['loginctl', ['enable-linger', 'ihor']],
      sudoLinger: ['sudo', ['-n', 'loginctl', 'enable-linger', 'ihor']],
      reload: ['systemctl', ['--user', 'daemon-reload']],
      enable: ['systemctl', ['--user', 'enable', '--now', 'mwc-runner.service']],
      restart: ['systemctl', ['--user', 'restart', 'mwc-runner.service']],
      disable: ['systemctl', ['--user', 'disable', '--now', 'mwc-runner.service']],
    });
  });
});

const commandLine = (call: { file: string; args: readonly string[] }) => [call.file, ...call.args].join(' ');

describe('installing and removing the systemd unit', () => {
  it('writes the unit (0644), lingers, reloads and enables it now; a reinstall restarts it', async () => {
    const { host, home, execs } = testHost();
    const manager = systemdManager(host);
    const unit = join(home, '.config/systemd/user/mwc-runner.service');
    expect(manager).toMatchObject({
      name: 'systemd user unit',
      file: unit,
      logs: 'journalctl --user -u mwc-runner.service -f',
    });
    expect(await manager.install()).toEqual([]);
    expect(statSync(unit).mode & 0o777).toBe(0o644);
    expect(readFileSync(unit, 'utf8')).toContain('ExecStart="/opt/node/bin/node"');
    expect(execs.map(commandLine)).toEqual([
      'loginctl enable-linger ihor',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now mwc-runner.service',
    ]);
    // A bare SSH command may have no XDG_RUNTIME_DIR: systemctl --user finds the manager through it.
    expect(execs[1]?.env?.XDG_RUNTIME_DIR).toBe('/run/user/501');
    await manager.install();
    expect(execs.slice(3).map(commandLine)).toEqual([
      'loginctl enable-linger ihor',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now mwc-runner.service',
      'systemctl --user restart mwc-runner.service',
    ]);
  });

  it('skips lingering when it is on, tries sudo when loginctl is refused, and warns when both are', async () => {
    const lingering = testHost({
      files: ['/var/lib/systemd/linger/ihor'],
      env: { XDG_RUNTIME_DIR: '/run/u' },
    });
    await systemdManager(lingering.host).install();
    expect(lingering.execs.map((call) => call.file)).toEqual(['systemctl', 'systemctl']);
    expect(lingering.execs[0]?.env?.XDG_RUNTIME_DIR).toBe('/run/u');
    const refused = { code: 1, stdout: '', stderr: 'Could not enable linger: Access denied' };
    const sudo = testHost({ exec: (file) => (file === 'loginctl' ? refused : undefined) });
    expect(await systemdManager(sudo.host).install()).toEqual([]);
    expect(sudo.execs[1]?.file).toBe('sudo');
    const neither = testHost({ exec: (file) => (file === 'systemctl' ? undefined : refused) });
    expect(await systemdManager(neither.host).install()).toEqual([
      'the runner stops when you log out: lingering could not be turned on (run sudo loginctl enable-linger ihor)',
    ]);
  });

  it('stops at a systemctl that fails, with its message', async () => {
    const { host } = testHost({
      files: ['/var/lib/systemd/linger/ihor'],
      exec: (_file, args) =>
        args.includes('enable')
          ? { code: 1, stdout: '', stderr: 'Failed to connect to bus: No medium found' }
          : undefined,
    });
    await expect(systemdManager(host).install()).rejects.toThrow(
      'systemctl --user enable --now mwc-runner.service failed: Failed to connect to bus: No medium found',
    );
  });

  it('disables the unit, removes it and reloads; nothing installed is fine', async () => {
    const { host, execs } = testHost();
    const manager = systemdManager(host);
    await manager.remove();
    expect(execs).toEqual([]);
    await manager.install();
    execs.length = 0;
    await manager.remove();
    expect(host.fs.exists(manager.file)).toBe(false);
    expect(execs.map(commandLine)).toEqual([
      'systemctl --user disable --now mwc-runner.service',
      'systemctl --user daemon-reload',
    ]);
  });
});
