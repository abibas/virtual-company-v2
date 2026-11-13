import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { newId } from '@mwc/shared/ids';
import type { MachineSample } from '@mwc/shared/machines';
import { RUNNER_CLOSE, RUNNER_SUBPROTOCOL, type RunnerFrame } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  FAKE_CLAUDE_VERSION,
  FAKE_FOLDER_LIST,
  FakeRunner,
  type FakeRunnerOptions,
  FakeRunnerServer,
} from '../../src/runner.ts';

const servers: FakeRunnerServer[] = [];
const runners: FakeRunner[] = [];

async function setUp(options: Omit<FakeRunnerOptions, 'url'> = {}) {
  const server = await FakeRunnerServer.start();
  servers.push(server);
  const runner = new FakeRunner({ url: server.url, ...options });
  runners.push(runner);
  return { server, runner };
}

const sample = (load1: number): MachineSample => ({
  load1,
  load5: 0.5,
  load15: 0.4,
  cpus: 8,
  cpuPct: 20,
  memPct: 55,
  diskUsed: 10,
  diskTotal: 100,
  uptimeS: 3600,
  liveRuns: 0,
  at: Date.now(),
});

const devboxTarget = {
  provider: 'airia_devbox',
  ref: { instance: 'dev-ihor', zone: 'europe-west1-b' },
} as const;

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.disconnect()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('FakeRunner: connecting', () => {
  it('says hello, then on server.hello sends its resync and its hold state', async () => {
    const { server, runner } = await setUp({ key: 'mwc_rk_key' });
    const hello = await runner.connect();
    expect(hello).toMatchObject({ type: 'server.hello', machineId: server.machineId });
    expect(runner.connected).toBe(true);
    expect(await server.frames.next('runner.hello')).toEqual({
      type: 'runner.hello',
      protocol: 1,
      version: '1.0.0',
      builtAt: null,
      caps: {
        harnesses: { claude_code: FAKE_CLAUDE_VERSION, codex: null },
        slots: 8,
        hold: 'none',
        power: [],
        terminal: false,
        selfUpdate: false,
        folders: false,
        mkdirp: false,
        forks: false,
        reattach: false,
        agentTools: false,
        serverTools: false,
        github: false,
      },
    });
    expect(await server.frames.next('runner.resync')).toEqual({ type: 'runner.resync', runs: [] });
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'server',
    });
    expect(server.connections[0]?.authorization).toBe('Bearer mwc_rk_key');
  });

  it('says what its options say', async () => {
    const run = { runId: newId(), state: 'running', exitCode: null, lastSeq: 9 } as const;
    const until = Date.now() + 60_000;
    const { server, runner } = await setUp({
      version: '0.5.0-rc.1',
      protocol: 2,
      build: 'ab'.repeat(32),
      caps: { slots: 4, hold: 'devbox_keepalive', power: ['airia_devbox'] },
      runs: [run],
      hold: { until, source: 'live_runs' },
      turns: [{ turnId: run.runId, lastSeq: 4, ended: false }],
    });
    await runner.connect();
    expect(await server.frames.next('runner.hello')).toMatchObject({
      protocol: 2,
      version: '0.5.0-rc.1',
      build: 'ab'.repeat(32),
      turns: [{ turnId: run.runId, lastSeq: 4, ended: false }],
      caps: {
        harnesses: { claude_code: FAKE_CLAUDE_VERSION, codex: null },
        slots: 4,
        hold: 'devbox_keepalive',
        power: ['airia_devbox'],
      },
    });
    expect((await server.frames.next('runner.resync')).runs).toEqual([run]);
    expect(await server.frames.next('hold.state')).toMatchObject({ until, source: 'live_runs' });
  });

  it('connects in one call, and rejects when nothing listens or the socket closes before the hello', async () => {
    const quiet = await FakeRunnerServer.start({ hello: false });
    servers.push(quiet);
    const waiting = new FakeRunner({ url: quiet.url });
    runners.push(waiting);
    const connecting = waiting.connect();
    await quiet.frames.next('runner.hello');
    quiet.dropAll();
    await expect(connecting).rejects.toThrow('The socket closed (1006) before server.hello');
    await quiet.stop();
    await expect(FakeRunner.connect({ url: quiet.url })).rejects.toThrow('ECONNREFUSED');
    const { server } = await setUp();
    const runner = await FakeRunner.connect({ url: server.url });
    runners.push(runner);
    expect(runner.connected).toBe(true);
  });
});

describe('FakeRunner: heartbeats', () => {
  it('carries the scripted samples one per heartbeat, then none', async () => {
    const { server, runner } = await setUp({ samples: [sample(0.8), sample(1.6)] });
    await runner.connect();
    runner.liveRuns = [newId()];
    const first = runner.heartbeat();
    const second = runner.heartbeat();
    const third = runner.heartbeat({ backlog: 7 });
    expect(first).toMatchObject({ type: 'runner.heartbeat', load1: 0.8, sample: { load1: 0.8 } });
    expect(second.sample?.load1).toBe(1.6);
    expect(third).not.toHaveProperty('sample');
    expect(third).toMatchObject({ load1: 0, backlog: 7, liveRuns: runner.liveRuns });
    expect(third.awakeMs).toBeGreaterThanOrEqual(0);
    expect(await server.frames.next('runner.heartbeat')).toEqual(first);
    expect(await server.frames.next('runner.heartbeat')).toEqual(second);
    expect(await server.frames.next('runner.heartbeat')).toEqual(third);
  });

  it('sends a sample given by hand without using up the script', async () => {
    const { runner } = await setUp({ samples: [sample(0.8)] });
    await runner.connect();
    expect(runner.heartbeat({ sample: sample(3) }).load1).toBe(3);
    expect(runner.heartbeat().load1).toBe(0.8);
  });
});

describe('FakeRunner: commands', () => {
  it('records every server frame and acks every command; power.command and runner.update get their results', async () => {
    const { server, runner } = await setUp();
    await runner.connect();
    const hold = newId();
    const power = newId();
    const update = newId();
    server.send({ type: 'job.offer', id: newId(), runId: newId(), agentId: newId(), expiresAt: Date.now() });
    server.send({ type: 'machine.hold', cmdId: hold, until: null });
    server.send({ type: 'power.command', cmdId: power, target: devboxTarget, action: 'status' });
    server.send({ type: 'runner.update', cmdId: update });
    expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId: hold, ok: true });
    expect(await server.frames.next('power.result')).toEqual({
      type: 'power.result',
      cmdId: power,
      ok: true,
    });
    expect(await server.frames.next('runner.update.result')).toEqual({
      type: 'runner.update.result',
      cmdId: update,
      ok: true,
    });
    expect(runner.frames.all.map((frame) => frame.type)).toEqual([
      'server.hello',
      'job.offer',
      'machine.hold',
      'power.command',
      'runner.update',
    ]);
    expect(server.frames.all.map((frame) => frame.type)).toEqual([
      'runner.hello',
      'runner.resync',
      'hold.state',
      'cmd.ack',
      'power.result',
      'runner.update.result',
    ]);
  });

  it('answers fs.list with an empty work volume, and fs.mkdir and fs.mkdirp with their path', async () => {
    const { server, runner } = await setUp();
    await runner.connect();
    const list = newId();
    const made = newId();
    server.send({ type: 'fs.list', cmdId: list, path: null });
    expect(await server.frames.next('fs.result')).toEqual({ ...FAKE_FOLDER_LIST, cmdId: list });
    server.send({ type: 'fs.mkdir', cmdId: made, path: '/work/scout' });
    expect(await server.frames.next('fs.result')).toEqual({
      type: 'fs.result',
      cmdId: made,
      ok: true,
      path: '/work/scout',
    });
    const deep = newId();
    server.send({ type: 'fs.mkdirp', cmdId: deep, path: '/work/a/b' });
    expect(await server.frames.next('fs.result')).toEqual({
      type: 'fs.result',
      cmdId: deep,
      ok: true,
      path: '/work/a/b',
      created: true,
    });
  });

  it('answers the tools frames with its caps.tools, and acks them as unknown without', async () => {
    const tools = { claude: '2.1.319 (Claude Code)', codex: null, git: null, gh: null, docker: null };
    const { server, runner } = await setUp({ caps: { tools } });
    await runner.connect();
    const check = newId();
    server.send({ type: 'tools.check', cmdId: check });
    expect(await server.frames.next('tools.result')).toEqual({
      type: 'tools.result',
      cmdId: check,
      ok: true,
      tools,
    });
    const install = newId();
    server.send({ type: 'tools.install', cmdId: install, tool: 'codex', version: '0.163.0' });
    expect(await server.frames.next('tools.result')).toEqual({
      type: 'tools.result',
      cmdId: install,
      ok: true,
      tools: { ...tools, codex: '0.163.0' },
    });
    const old = await setUp();
    await old.runner.connect();
    const unknown = newId();
    old.server.send({ type: 'tools.check', cmdId: unknown });
    expect(await old.server.frames.next('cmd.ack')).toEqual({
      type: 'cmd.ack',
      cmdId: unknown,
      ok: false,
      error: 'unknown command',
    });
  });

  it('answers as a test scripts it, and acks by hand', async () => {
    const answers: RunnerFrame[] = [{ type: 'hold.state', until: null, source: 'server' }];
    const { server, runner } = await setUp({
      respond: (frame) => (frame.type === 'machine.hold' ? answers : []),
    });
    await runner.connect();
    await server.frames.next('hold.state');
    const drain = newId();
    server.send({ type: 'runner.drain', cmdId: drain });
    await runner.frames.next('runner.drain');
    server.send({ type: 'machine.hold', cmdId: newId(), until: null });
    await server.frames.next('hold.state');
    runner.ack(drain);
    runner.ack(drain, 'already draining');
    expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId: drain, ok: true });
    expect(await server.frames.next('cmd.ack')).toEqual({
      type: 'cmd.ack',
      cmdId: drain,
      ok: false,
      error: 'already draining',
    });
  });

  it('records unknown and invalid server frames apart', async () => {
    const { server, runner } = await setUp();
    await runner.connect();
    server.sendRaw('{"type":"server.hello.update"}');
    server.sendRaw('{"type":"run.ack","runId":"x","ackedSeq":1}');
    server.send({ type: 'runner.drain', cmdId: newId() });
    await runner.frames.next('runner.drain');
    expect(runner.unknown).toEqual(['server.hello.update']);
    expect(runner.invalid.map((error) => error.frameType)).toEqual(['run.ack']);
  });
});

describe('FakeRunner: closing and reconnecting', () => {
  it('refuses to send or report a close before it connects', async () => {
    const { runner } = await setUp();
    expect(runner.connected).toBe(false);
    expect(() => runner.heartbeat()).toThrow('The fake runner is not connected');
    expect(() => runner.closed()).toThrow('The fake runner never connected');
    await runner.disconnect();
  });

  it('takes a hello followed at once by a close (a runner too old) without throwing', async () => {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      handleProtocols: () => RUNNER_SUBPROTOCOL,
    });
    await once(wss, 'listening');
    wss.on('connection', (socket) =>
      socket.once('message', () => {
        socket.send(
          JSON.stringify({
            type: 'server.hello',
            protocol: 1,
            minRunnerVersion: '2.0.0',
            machineId: newId(),
          }),
        );
        socket.close(RUNNER_CLOSE.runnerTooOld, 'runner too old');
      }),
    );
    const runner = new FakeRunner({ url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}` });
    runners.push(runner);
    expect((await runner.connect()).minRunnerVersion).toBe('2.0.0');
    expect(await runner.closed()).toEqual({ code: 4003, reason: 'runner too old' });
    await new Promise((resolve) => wss.close(resolve));
  });

  it('disconnects cleanly once, and reconnects with a new hello and resync', async () => {
    const { server, runner } = await setUp();
    await runner.connect();
    await runner.disconnect(4000);
    expect(await runner.closed()).toEqual({ code: 4000, reason: '' });
    await runner.disconnect();
    expect(() => runner.ack(newId())).toThrow('not connected');
    await runner.reconnect();
    await runner.reconnect();
    expect(server.frames.of('runner.hello')).toHaveLength(3);
    await expect.poll(() => server.frames.of('runner.resync')).toHaveLength(3);
    expect(server.connections).toHaveLength(3);
  });
});
