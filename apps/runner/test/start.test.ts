import { chmodSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { newId } from '@mwc/shared/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRunnerConfig } from '../src/config.ts';
import { CAFFEINATE_BIN, DEVBOX_KEEPALIVE_BIN } from '../src/hold/driver.ts';
import { EXIT, holdDriverFor, main } from '../src/start.ts';
import { cleanUpLinks, fakeServer } from './fixtures/link.ts';
import { FakePtySpawner } from './fixtures/pty.ts';
import { ROTATED_KEY, RUNNER_KEY } from './fixtures/runner.ts';
import { world } from './fixtures/start.ts';

afterEach(cleanUpLinks);

describe('mwc-runner refusing to start', () => {
  it('knows only `run`', async () => {
    const { deps, entries, exits } = world();
    expect(await main([], deps)).toBe(EXIT.usage);
    expect(await main(['run', '--now'], deps)).toBe(EXIT.usage);
    expect(exits).toEqual([64, 64]);
    expect(entries()[0]).toMatchObject({ level: 'error', msg: 'usage: mwc-runner run' });
  });

  it('exits with the configuration code when runner.json is missing or a variable is wrong', async () => {
    const missing = world();
    const env = { ...missing.deps.env, MWC_RUNNER_CONFIG: join(missing.dir, 'none.json') };
    const code = await main(['run'], { ...missing.deps, env });
    expect(code).toBe(EXIT.config);
    expect(missing.entries()[0]?.msg).toContain(
      'none.json does not exist; enroll this machine first (mwc machine enroll-token prints its install command)',
    );
    const hold = world({ env: { MWC_RUNNER_HOLD: 'pmset' } });
    expect(await main(['run'], hold.deps)).toBe(EXIT.config);
    const port = world({ env: { MWC_RUNNER_HEALTH_PORT: 'x' } });
    expect(await main(['run'], port.deps)).toBe(EXIT.config);
    expect(port.exits).toEqual([78]);
  });
});

describe('mwc-runner run', () => {
  it('connects, serves its health, logs JSON lines without the key, and stops on SIGTERM', async () => {
    const server = await fakeServer();
    const { deps, lines, entries, logged, signals, dir, mkdirs } = world({ server });
    const running = main(['run'], deps);
    await server.frames.next('runner.heartbeat');
    await logged('health endpoint listening');
    expect(mkdirs).toEqual([join(dir, 'state')]);
    const url = entries().find((entry) => entry.msg === 'health endpoint listening')?.url as string;
    await vi.waitFor(async () => expect(await (await fetch(url)).json()).toMatchObject({ connected: true }));
    expect(entries()[0]).toMatchObject({ msg: 'starting', version: '0.1.0', hold: 'none', name: 'This Mac' });
    expect(lines.join('')).not.toContain(RUNNER_KEY);
    signals.get('SIGTERM')?.();
    signals.get('SIGINT')?.();
    expect(await running).toBe(EXIT.ok);
    expect(entries().filter((entry) => entry.msg === 'stopping')).toHaveLength(1);
    expect(entries().at(-1)).toMatchObject({ msg: 'stopped', code: 0 });
    await expect(fetch(url)).rejects.toThrow();
  });

  it('holds This Mac with caffeinate and kills it when stopped (SIGINT)', async () => {
    const server = await fakeServer();
    const power = { providers: ['airia_devbox' as const], execute: async () => ({ ok: true }) };
    const { deps, spawn, signals, time } = world({ server, platform: 'darwin', power });
    spawn.when('/usr/sbin/sysctl', (child) => child.finish('70\n'));
    const running = main(['run'], deps);
    const { caps } = await server.frames.next('runner.hello');
    expect(caps).toMatchObject({ hold: 'caffeinate', power: ['airia_devbox'] });
    expect((await server.frames.next('runner.heartbeat')).sample?.memPct).toBe(30);
    server.send({ type: 'machine.hold', cmdId: newId(), until: time.now() + 60_000 });
    await server.frames.next('cmd.ack');
    const caffeinate = spawn.of(CAFFEINATE_BIN);
    expect(caffeinate.map((call) => call.args)).toEqual([['-i', '-w', '4242']]);
    signals.get('SIGINT')?.();
    expect(await running).toBe(EXIT.ok);
    expect(caffeinate[0]?.child.signals).toEqual(['SIGTERM']);
  });

  it('opens terminals when its PTY loads, in the home folder, and says why there are none when it does not', async () => {
    const server = await fakeServer();
    const spawner = new FakePtySpawner();
    const loadPty = () => ({ ok: true as const, target: 'linux-x64' as const, spawn: spawner.spawn });
    const { deps, dir, entries, signals } = world({ server, loadPty, env: { SHELL: '/bin/zsh' } });
    const running = main(['run'], deps);
    expect((await server.frames.next('runner.hello')).caps.terminal).toBe(true);
    expect(entries().find((entry) => entry.msg === 'terminal ready')).toMatchObject({ pty: 'linux-x64' });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'terminal.open', sessionId: newId(), cols: 80, rows: 24 });
    await server.frames.next('terminal.opened');
    // The fake machine has no /bin/zsh, nor bash: the shell falls back to /bin/sh.
    expect(spawner.spawned[0]).toMatchObject({ file: '/bin/sh', options: { cwd: dir } });
    signals.get('SIGTERM')?.();
    expect(await running).toBe(EXIT.ok);
    expect((await server.frames.next('terminal.exit')).error).toBe('runner_stopping');
    const without = await fakeServer();
    const none = world({ server: without });
    const second = main(['run'], none.deps);
    expect((await without.frames.next('runner.hello')).caps.terminal).toBe(false);
    expect(none.entries().find((entry) => entry.msg === 'no terminal on this machine')).toMatchObject({
      level: 'warn',
      reason: 'no PTY in this test',
    });
    none.signals.get('SIGTERM')?.();
    await second;
  });

  it('saves a rotated key to runner.json, still 0600', async () => {
    const server = await fakeServer();
    // Without HOME (a bare service environment) the disk measured is the home folder from os.homedir().
    const { deps, configPath, signals } = world({ server, env: { HOME: undefined } });
    chmodSync(configPath, 0o644);
    const running = main(['run'], deps);
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'key.rotate', cmdId: newId(), runnerKey: ROTATED_KEY });
    await server.frames.next('cmd.ack');
    expect(readRunnerConfig(configPath).runnerKey).toBe(ROTATED_KEY);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    signals.get('SIGTERM')?.();
    await running;
  });

  it('warns about a configuration others can read, and goes on without health when the port is taken', async () => {
    const server = await fakeServer();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as { port: number }).port;
    const { deps, configPath, entries, logged, signals } = world({
      server,
      env: { MWC_RUNNER_HEALTH_PORT: String(port) },
    });
    chmodSync(configPath, 0o640);
    const running = main(['run'], deps);
    await logged('the health endpoint cannot listen; going on without it');
    await server.frames.next('runner.heartbeat');
    expect(entries().find((entry) => entry.level === 'warn')).toMatchObject({
      msg: 'the runner configuration is readable by others; chmod 600 it',
    });
    signals.get('SIGTERM')?.();
    expect(await running).toBe(EXIT.ok);
    await new Promise<void>((resolve) => taken.close(() => resolve()));
  });
});

describe('when the server ends the link', () => {
  it('exits 77 when the key is refused (4001), saying to enroll again', async () => {
    const server = await fakeServer();
    const { deps, entries } = world({ server });
    const running = main(['run'], deps);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4001);
    expect(await running).toBe(EXIT.unauthorized);
    expect(entries().find((entry) => entry.level === 'error')).toMatchObject({
      msg: 'the server refused the runner key (revoked, or the machine was removed); enroll it again',
      code: 4001,
    });
  });

  it('exits 76 when the runner is too old (4003), naming both versions', async () => {
    const server = await fakeServer({ minRunnerVersion: '2.0.0' });
    const { deps, entries } = world({ server });
    const running = main(['run'], deps);
    await server.frames.next('runner.resync');
    await server.closeAll(4003);
    expect(await running).toBe(EXIT.tooOld);
    expect(entries().find((entry) => entry.level === 'error')).toMatchObject({
      msg: 'this runner is older than the server takes; update it',
      version: '0.1.0',
      minRunnerVersion: '2.0.0',
    });
  });

  it('stays up idle when replaced (4004) until a signal stops it', async () => {
    const server = await fakeServer();
    const { deps, keepAlive, signals, logged, exits } = world({ server });
    const running = main(['run'], deps);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4004);
    await logged(
      'a newer connection of this machine replaced this one; not reconnecting until the runner restarts',
    );
    await vi.waitFor(() => expect(keepAlive.held).toBe(1));
    expect(exits).toEqual([]);
    signals.get('SIGTERM')?.();
    expect(await running).toBe(EXIT.ok);
    expect(keepAlive.released).toBe(1);
  });
});

describe('the hold driver of each kind', () => {
  it('builds the devbox, caffeinate and none drivers', () => {
    const { deps } = world();
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    expect(holdDriverFor('devbox_keepalive', deps, log).kind).toBe('devbox_keepalive');
    expect(holdDriverFor('caffeinate', deps, log).kind).toBe('caffeinate');
    expect(holdDriverFor('none', deps, log).kind).toBe('none');
    expect(DEVBOX_KEEPALIVE_BIN).toBe('/usr/local/bin/devbox-keepalive');
  });
});
