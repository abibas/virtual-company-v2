import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRunnerConfig, writeRunnerConfig } from '../../src/config.ts';
import { installCommand } from '../../src/install/install.ts';
import { downloadedBundle, enrollWorld, NODE, noFetch, SERVER, testHost } from '../fixtures/host.ts';
import { runnerConfig } from '../fixtures/runner.ts';

let w: Awaited<ReturnType<typeof enrollWorld>>;
beforeAll(async () => {
  w = await enrollWorld();
});
afterAll(() => w.t.close());

const commandLine = (call: { file: string; args: readonly string[] }) => [call.file, ...call.args].join(' ');

describe('mwc-runner install on macOS', () => {
  it('enrolls, copies the downloaded runner to ~/.local/share/mwc-runner and loads the launchd agent', async () => {
    const { host, home, execs, out } = testHost({ platform: 'darwin', fetch: w.fetch });
    downloadedBundle(host, '// runner 0.1.0\n');
    expect(await installCommand(host, { server: SERVER, token: await w.token() })).toBe(0);
    const bundle = join(home, '.local/share/mwc-runner/runner.mjs');
    expect(readFileSync(bundle, 'utf8')).toBe('// runner 0.1.0\n');
    const plist = join(home, 'Library/LaunchAgents/com.mwc.runner.plist');
    expect(readFileSync(plist, 'utf8')).toContain(`<string>${bundle}</string>`);
    expect(execs.map(commandLine)).toEqual([`/bin/launchctl bootstrap gui/501 ${plist}`]);
    const config = readRunnerConfig(join(home, '.config/mwc/runner.json'));
    expect(out()).toBe(
      `Enrolled this machine as "ihors-mac" (laptop), machine ${config.machineId}, on ${SERVER}. ` +
        `Its runner key is in ${home}/.config/mwc/runner.json (readable by you only).\n` +
        `Installed the runner in ${bundle} and started it as a launchd agent (${plist}).\n` +
        "warning: the terminal's PTY did not come with this runner (install.sh downloads it); no terminal here\n" +
        `Check it with: ${NODE} ${bundle} status\n` +
        `Its log: tail -f ${home}/.local/state/mwc-runner/runner.log\n`,
    );
  });
});

describe('mwc-runner install --via', () => {
  /** The fetch of the test app, with the addresses it was called with. */
  function recording() {
    const urls: string[] = [];
    const fetch: typeof w.fetch = (url, init) => {
      urls.push(String(url));
      return w.fetch(url, init);
    };
    return { urls, fetch };
  }
  const VIA = 'http://127.0.0.1:9954';

  it('enrolls through --via and saves --server for the runner', async () => {
    const { urls, fetch } = recording();
    const { host, home, out } = testHost({ fetch, files: ['/var/lib/systemd/linger/ihor'] });
    downloadedBundle(host);
    const input = { server: 'http://127.0.0.1:9950', via: `${VIA}/`, token: await w.token() };
    expect(await installCommand(host, input)).toBe(0);
    expect(urls).toEqual([`${VIA}/api/runner/enroll`]);
    expect(readRunnerConfig(join(home, '.config/mwc/runner.json')).serverUrl).toBe('http://127.0.0.1:9950');
    expect(out()).toContain('on http://127.0.0.1:9950.');
  });

  it('enrolls through --server without --via, as before', async () => {
    const { urls, fetch } = recording();
    const { host, home } = testHost({ fetch, files: ['/var/lib/systemd/linger/ihor'] });
    downloadedBundle(host);
    expect(await installCommand(host, { server: SERVER, token: await w.token() })).toBe(0);
    expect(urls).toEqual([`${SERVER}/api/runner/enroll`]);
    expect(readRunnerConfig(join(home, '.config/mwc/runner.json')).serverUrl).toBe(SERVER);
  });

  it("takes --via on a reinstall without a token (the downloads are install.sh's), and refuses a bad one", async () => {
    const { host, home, out } = testHost({ fetch: noFetch, files: ['/var/lib/systemd/linger/ihor'] });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    downloadedBundle(host);
    await expect(installCommand(host, { server: SERVER, via: 'ftp://x' })).rejects.toThrow(
      expect.objectContaining({ code: 64, message: expect.stringContaining('--via needs') }),
    );
    expect(await installCommand(host, { server: SERVER, via: VIA })).toBe(0);
    expect(out()).toContain('Keeping the enrollment as');
    expect(readRunnerConfig(join(home, '.config/mwc/runner.json')).serverUrl).toBe(SERVER);
  });
});

describe('mwc-runner install on Linux', () => {
  it('keeps the enrollment it has without a token, and runs from the installed copy without copying it', async () => {
    const { host, home, execs, out } = testHost({ fetch: noFetch, files: ['/var/lib/systemd/linger/ihor'] });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER, { name: 'Airia devbox' }));
    const installed = { ...host, selfPath: join(home, '.local/share/mwc-runner/runner.mjs') };
    downloadedBundle(installed, '// installed\n');
    expect(await installCommand(installed, {})).toBe(0);
    expect(readFileSync(installed.selfPath, 'utf8')).toBe('// installed\n');
    expect(execs.map(commandLine)).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now mwc-runner.service',
    ]);
    expect(out()).toMatch(
      /^Keeping the enrollment as "Airia devbox", machine [-0-9a-f]+, on https:\/\/corp\.example\.test\.\n/,
    );
    expect(out()).toContain('started it as a systemd user unit');
    expect(out()).toContain('Its log: journalctl --user -u mwc-runner.service -f\n');
  });

  it('shows the warnings of the service manager', async () => {
    const refused = { code: 1, stdout: '', stderr: 'Access denied' };
    const { host, home, out } = testHost({ exec: (file) => (file === 'systemctl' ? undefined : refused) });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    downloadedBundle(host);
    await installCommand(host, {});
    expect(out()).toContain('warning: the runner stops when you log out');
  });
});

describe("mwc-runner install and the terminal's PTY", () => {
  /** A PTY package for the host's system (linux-arm64) beside a runner in `dir`. */
  function ptyBesideRunner(dir: string): string {
    const pty = join(dir, 'node_modules/@lydell/node-pty-linux-arm64');
    mkdirSync(join(pty, 'prebuilds/linux-arm64'), { recursive: true });
    writeFileSync(join(pty, 'package.json'), '{"name":"@lydell/node-pty-linux-arm64"}');
    writeFileSync(join(pty, 'prebuilds/linux-arm64/pty.node'), 'native');
    chmodSync(join(pty, 'prebuilds/linux-arm64/pty.node'), 0o755);
    return pty;
  }

  it('puts the PTY install.sh unpacked beside the downloaded runner beside the installed one, modes kept', async () => {
    const { host, home, out } = testHost({ files: ['/var/lib/systemd/linger/ihor'] });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    downloadedBundle(host);
    ptyBesideRunner(dirname(host.selfPath));
    const stale = join(home, '.local/share/mwc-runner/node_modules/old-pty');
    mkdirSync(stale, { recursive: true });
    await installCommand(host, {});
    const installed = join(home, '.local/share/mwc-runner/node_modules/@lydell/node-pty-linux-arm64');
    expect(readFileSync(join(installed, 'package.json'), 'utf8')).toContain('node-pty-linux-arm64');
    expect(statSync(join(installed, 'prebuilds/linux-arm64/pty.node')).mode & 0o777).toBe(0o755);
    expect(existsSync(stale)).toBe(false);
    expect(out()).toContain(`The terminal's PTY (linux-arm64) is in ${installed}.\n`);
  });

  it('keeps the PTY beside the installed runner when reinstalled from it, and warns without one', async () => {
    const { host, home, out } = testHost({ files: ['/var/lib/systemd/linger/ihor'] });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    const installed = { ...host, selfPath: join(home, '.local/share/mwc-runner/runner.mjs') };
    downloadedBundle(installed);
    await installCommand(installed, {});
    expect(out()).toContain("warning: the terminal's PTY did not come with this runner");
    const pty = ptyBesideRunner(dirname(installed.selfPath));
    await installCommand(installed, {});
    expect(existsSync(pty)).toBe(true);
    expect(out()).toContain(`The terminal's PTY (linux-arm64) is in ${pty}.\n`);
  });

  it('says there is no terminal on a system no PTY is built for', async () => {
    const { host, home, out } = testHost({ files: ['/var/lib/systemd/linger/ihor'] });
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    downloadedBundle(host);
    await installCommand({ ...host, arch: 'ppc64' }, {});
    expect(out()).toContain('warning: no terminal on linux-ppc64: no PTY is built for it\n');
  });
});

describe('mwc-runner install refusing', () => {
  it('refuses before the token is used: another system, a container, the sources', async () => {
    const token = `mwc_et_${'a1B2'.repeat(8)}`;
    const cases = [
      [{ platform: 'win32' as const }, 'not on win32', 1],
      [{ files: ['/.dockerenv'] }, "the container's main process", 1],
      [{ selfPath: '/repo/apps/runner/src/main.ts' }, 'run it from the built runner.mjs', 1],
    ] as const;
    for (const [options, message, code] of cases) {
      const { host } = testHost({ ...options, fetch: noFetch });
      await expect(installCommand(host, { server: SERVER, token })).rejects.toThrow(
        expect.objectContaining({ code, message: expect.stringContaining(message) }),
      );
    }
  });

  it('takes --server without --token as a reinstall on the server it is enrolled on, and refuses another', async () => {
    const { host, home, out } = testHost({ fetch: noFetch, files: ['/var/lib/systemd/linger/ihor'] });
    await expect(installCommand(host, { server: SERVER })).rejects.toThrow(
      expect.objectContaining({ code: 78, message: expect.stringContaining('give --server and --token') }),
    );
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), runnerConfig(SERVER));
    downloadedBundle(host);
    await expect(installCommand(host, { server: 'https://other.example.test' })).rejects.toThrow(
      expect.objectContaining({
        code: 64,
        message: `this machine is enrolled on ${SERVER}, not https://other.example.test; give --token to enroll it there`,
      }),
    );
    expect(await installCommand(host, { server: `${SERVER}/` })).toBe(0);
    expect(out()).toContain(`Keeping the enrollment as "This Mac"`);
  });

  it('says to give a token when the machine has no enrollment, with the configuration code', async () => {
    const { host } = testHost({ fetch: noFetch });
    await expect(installCommand(host, {})).rejects.toThrow(
      expect.objectContaining({
        code: 78,
        message: expect.stringContaining('give --server and --token to enroll it'),
      }),
    );
  });
});
