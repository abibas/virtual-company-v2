import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HELP, parseOptions, runCli, selfFacts, serviceExit } from '../src/cli.ts';
import type { MainDeps } from '../src/daemon/start.ts';
import { EXIT } from '../src/daemon/start.ts';
import type { Host } from '../src/install/host.ts';
import { PERMANENT_EXIT_CODES } from '../src/install/systemd.ts';
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

describe('mwc-runner mcp', () => {
  it('serves MCP on the stdio it is given, with the runner’s version, until its input ends', async () => {
    const { host } = testHost();
    const out: string[] = [];
    const versions: string[] = [];
    const ping = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`;
    const mcp = (version: string) => {
      versions.push(version);
      const input = (async function* () {
        yield ping;
      })();
      return { input, write: (line: string) => void out.push(line), env: {}, version };
    };
    expect(await runCli(['mcp'], { daemon: unusedDaemon, host: () => host, mcp })).toBe(0);
    expect(out).toEqual([`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`]);
    expect(versions).toEqual([host.version]);
    expect(HELP).toContain('  mcp ');
  });
});

describe('mwc-runner run', () => {
  it("starts the daemon with its CLIs' versions and Claude Code's in its hello, asking each CLI found once", async () => {
    const server = await fakeServer();
    const { deps, signals } = world({ server });
    const { host, home, execs } = testHost({
      env: { ...deps.env },
      exec: () => ({ code: 0, stdout: '2.1.3 (Claude Code)\n', stderr: '' }),
    });
    executable(join(home, 'bin'), 'claude');
    const running = runCli(['run'], { daemon: () => deps, host: () => host });
    const hello = await server.frames.next('runner.hello');
    expect(hello.claudeVersion).toBe('2.1.3 (Claude Code)');
    expect(hello.caps.harnesses).toEqual({ claude_code: '2.1.3 (Claude Code)', codex: null });
    const tools = { claude: '2.1.3 (Claude Code)', codex: null, git: null, gh: null, docker: null };
    expect(hello.caps.tools).toEqual(tools);
    expect(execs).toHaveLength(1);
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

describe('what the daemon learns about itself at start', () => {
  it('is the build of its bundle and, for the installed copy under its service manager, its self-update', async () => {
    const probe = testHost();
    const selfPath = join(probe.home, '.local', 'share', 'mwc-runner', 'runner.mjs');
    const env = { HOME: probe.home, MWC_RUNNER_SERVICE: 'systemd' };
    const { host } = testHost({ env, selfPath });
    downloadedBundle(host, '// installed\n');
    const facts = selfFacts(host);
    expect(facts.build).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.update?.manager).toBe('systemd');
    expect(facts.builtAt).toBeNull();
  });

  it('is its build time from the runner.json beside its bundle, which the hello then says', () => {
    const { host } = testHost();
    downloadedBundle(host, '// bundle\n');
    const manifest = { version: '0.5.0', builtAt: '2026-11-09T16:56:00.000Z', sha256: 'ab'.repeat(32) };
    writeFileSync(join(dirname(host.selfPath), 'runner.json'), JSON.stringify(manifest));
    expect(selfFacts(host).builtAt).toBe('2026-11-09T16:56:00.000Z');
  });

  it('is no build, no build time and no self-update from the sources', () => {
    expect(selfFacts(testHost({ selfPath: '/repo/apps/runner/src/main.ts' }).host)).toEqual({
      build: null,
      builtAt: null,
    });
  });
});

describe('the exit under a service manager', () => {
  it("restarts after an update with 75 under both: launchd's KeepAlive restarts a failure, systemd any exit but 76–78", () => {
    const codes: number[] = [];
    const logs = memoryLog();
    serviceExit({ MWC_RUNNER_SERVICE: 'launchd' }, (code) => codes.push(code), logs.log)(EXIT.restart);
    serviceExit({ MWC_RUNNER_SERVICE: 'systemd' }, (code) => codes.push(code), logs.log)(EXIT.restart);
    expect(codes).toEqual([75, 75]);
    expect(EXIT.restart).not.toBe(0);
    expect(PERMANENT_EXIT_CODES).not.toContain(EXIT.restart);
    expect(logs.messages('warn')).toEqual([]);
  });

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
