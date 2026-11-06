import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRunnerConfig } from '../../src/config.ts';
import { systemdManager } from '../../src/install/systemd.ts';
import { uninstallCommand } from '../../src/install/uninstall.ts';
import { testHost } from '../fixtures/host.ts';
import { runnerConfig } from '../fixtures/runner.ts';

/** A machine with the runner installed: its service, its copy, its configuration and its state folder. */
async function installed() {
  const world = testHost({ files: ['/var/lib/systemd/linger/ihor'] });
  const { host, home } = world;
  await systemdManager(host).install();
  mkdirSync(join(home, '.local/share/mwc-runner'), { recursive: true });
  writeFileSync(join(home, '.local/share/mwc-runner/runner.mjs'), '// runner\n');
  writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig());
  mkdirSync(join(home, '.local/state/mwc-runner'), { recursive: true });
  world.execs.length = 0;
  return world;
}

describe('mwc-runner uninstall', () => {
  it('stops and removes the service and the installed runner, and keeps the enrollment', async () => {
    const { host, home, execs, out } = await installed();
    expect(await uninstallCommand(host, {})).toBe(0);
    expect(execs.map((call) => call.args.join(' '))).toEqual([
      '--user disable --now mwc-runner.service',
      '--user daemon-reload',
    ]);
    expect(host.fs.exists(join(home, '.config/systemd/user/mwc-runner.service'))).toBe(false);
    expect(host.fs.exists(join(home, '.local/share/mwc-runner'))).toBe(false);
    expect(host.fs.exists(join(home, '.config/mwc/runner.json'))).toBe(true);
    expect(out()).toBe(
      `Stopped and removed the systemd user unit (${home}/.config/systemd/user/mwc-runner.service) and the ` +
        `installed runner (${home}/.local/share/mwc-runner).\n` +
        `Kept the enrollment in ${home}/.config/mwc/runner.json; uninstall --purge removes it too.\n` +
        'The machine stays on the server until you remove it on the Machines page.\n',
    );
  });

  it('removes the configuration and the state folder too with --purge', async () => {
    const { host, home, out } = await installed();
    await uninstallCommand(host, { purge: true });
    expect(host.fs.exists(join(home, '.config/mwc/runner.json'))).toBe(false);
    expect(host.fs.exists(join(home, '.local/state/mwc-runner'))).toBe(false);
    expect(out()).toContain('Removed the configuration with the runner key');
  });

  it('says when nothing was installed', async () => {
    const { host, home, execs, out } = testHost({ platform: 'darwin' });
    await uninstallCommand(host, {});
    expect(execs).toEqual([]);
    expect(out()).toContain(`No launchd agent was installed; removed ${home}/.local/share/mwc-runner.\n`);
  });
});
