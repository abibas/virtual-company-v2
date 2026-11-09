import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HELP, parseOptions, runCli, serviceExit } from '../src/cli.ts';
import type { Host } from '../src/install/host.ts';
import type { MainDeps } from '../src/start.ts';
import { downloadedBundle, enrollWorld, executable, json, SERVER, testHost } from './fixtures/host.ts';
import { cleanUpLinks, fakeServer } from './fixtures/link.ts';
import { memoryLog } from './fixtures/log.ts';
import { world } from './fixtures/start.ts';

let w: Awaited<ReturnType<typeof enrollWorld>>;
beforeAll(async () => {
  w = await enrollWorld();
});
afterAll(() => w.t.close());
afterEach(cleanUpLinks);

const unusedDaemon = (): MainDeps => {
  throw new Error('the daemon was made');
};
const cli = (argv: string[], host: Host) => runCli(argv, { daemon: unusedDaemon, host: () => host });

describe('mwc-runner', () => {
  it('shows its commands without one, with help, and refuses one it does not know', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const { host, out } = testHost();
      expect(await cli(argv, host)).toBe(0);
      expect(out()).toBe(HELP);
    }
    const { host, err } = testHost();
    expect(await cli(['toString'], host)).toBe(64);
    expect(err()).toBe(`mwc-runner: unknown command toString\n${HELP}`);
  });

  it('takes only the options of each command, each once with its value', () => {
    expect(parseOptions('install', ['--server', SERVER, '--token=t', '--force'])).toEqual({
      server: SERVER,
      token: 't',
      force: true,
    });
    expect(parseOptions('install', ['--server', SERVER, '--via=http://127.0.0.1:9954'])).toEqual({
      server: SERVER,
      via: 'http://127.0.0.1:9954',
    });
    expect(parseOptions('uninstall', ['--purge'])).toEqual({ purge: true });
    for (const [command, args] of [
      ['status', ['--purge']],
      ['enroll', ['--server']],
      ['enroll', ['--via', SERVER]],
      ['uninstall', ['now']],
    ] as const) {
      expect(() => parseOptions(command, args)).toThrow(expect.objectContaining({ code: 64 }));
    }
  });

  it('runs enroll, install, status and uninstall, and says why one failed on stderr with its code', async () => {
    const enroll = testHost({ fetch: w.fetch });
    expect(await cli(['enroll', '--server', SERVER, '--token', await w.token()], enroll.host)).toBe(0);
    expect(enroll.out()).toContain('Enrolled this machine as "ihors-mac" (vm)');
    const install = testHost({ platform: 'darwin', fetch: w.fetch });
    downloadedBundle(install.host);
    expect(await cli(['install', '--server', SERVER, '--token', await w.token()], install.host)).toBe(0);
    expect(install.execs.map((call) => call.args[0])).toEqual(['bootstrap']);
    expect(await cli(['status'], install.host)).toBe(1);
    expect(await cli(['uninstall'], install.host)).toBe(0);
    const usage = testHost();
    expect(await cli(['enroll', '--server', SERVER], usage.host)).toBe(64);
    expect(usage.err()).toMatch(/^mwc-runner enroll: --token needs an enrollment token/);
    const broken = testHost();
    const nameless = {
      ...broken.host,
      hostname: () => {
        throw new Error('no host name');
      },
    };
    expect(await cli(['enroll', '--server', SERVER, '--token', `mwc_et_${'a1B2'.repeat(8)}`], nameless)).toBe(
      1,
    );
    expect(broken.err()).toBe('mwc-runner enroll: no host name\n');
  });
});

describe('mwc-runner run', () => {
  it("starts the daemon with Claude Code's version in its hello", async () => {
    const server = await fakeServer();
    const { deps, signals } = world({ server });
    const { host, home } = testHost({
      env: { ...deps.env },
      exec: () => ({ code: 0, stdout: '2.1.3 (Claude Code)\n', stderr: '' }),
    });
    executable(join(home, 'bin'), 'claude');
    const running = runCli(['run'], { daemon: () => deps, host: () => host });
    expect((await server.frames.next('runner.hello')).claudeVersion).toBe('2.1.3 (Claude Code)');
    signals.get('SIGTERM')?.();
    expect(await running).toBe(0);
  });

  it('leaves its usage to the daemon, and stops with the code of a first start that cannot enroll', async () => {
    const usage = world();
    expect(await runCli(['run', '--now'], { daemon: () => usage.deps, host: () => testHost().host })).toBe(
      64,
    );
    const { deps, dir, exits, entries } = world({ env: { MWC_RUNNER_CONFIG: undefined } });
    const env = {
      ...deps.env,
      MWC_RUNNER_CONFIG: join(dir, 'state', 'runner.json'),
      MWC_ENROLL_TOKEN: `mwc_et_${'Zz09'.repeat(8)}`,
      MWC_SERVER_URL: SERVER,
    };
    const refused = json(401, { error: { code: 'unauthenticated', message: 'no' } });
    const { host } = testHost({ files: ['/.dockerenv'], env, fetch: async () => refused });
    expect(await runCli(['run'], { daemon: () => ({ ...deps, env }), host: () => host })).toBe(77);
    expect(exits).toEqual([77]);
    expect(entries().map((entry) => entry.msg)).toEqual([
      'enrolling this machine on its first start',
      expect.stringContaining('cannot enroll this machine: the server refused the enrollment token'),
    ]);
  });

  it('exits 0 under launchd after a permanent stop, so launchd leaves it stopped', async () => {
    const { deps, dir, exits, entries } = world();
    const env = { ...deps.env, MWC_RUNNER_CONFIG: join(dir, 'none.json'), MWC_RUNNER_SERVICE: 'launchd' };
    const { host } = testHost({ env });
    await runCli(['run'], { daemon: () => ({ ...deps, env }), host: () => host });
    expect(exits).toEqual([0]);
    expect(entries().at(-1)).toMatchObject({ level: 'warn', code: 78 });
  });
});

describe('the exit under a service manager', () => {
  it('turns 76, 77 and 78 into 0 under launchd only', () => {
    const codes: number[] = [];
    const logs = memoryLog();
    const launchd = serviceExit({ MWC_RUNNER_SERVICE: 'launchd' }, (code) => codes.push(code), logs.log);
    for (const code of [0, 1, 76, 77, 78]) launchd(code);
    serviceExit({}, (code) => codes.push(code), logs.log)(77);
    expect(codes).toEqual([0, 1, 0, 0, 0, 77]);
    expect(logs.messages('warn')).toHaveLength(3);
  });
});
