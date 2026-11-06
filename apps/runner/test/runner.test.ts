import { newId } from '@mwc/shared/ids';
import { RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RUNS_HOLD_MS } from '../src/hold/manager.ts';
import { NO_RUNS } from '../src/link/commands.ts';
import type { PowerExecutor } from '../src/power.ts';
import { createRunner } from '../src/runner.ts';
import { cleanUpLinks, fakeServer } from './fixtures/link.ts';
import { memoryLog } from './fixtures/log.ts';
import {
  fakeSampler,
  httpOf,
  ROTATED_KEY,
  RUNNER_KEY,
  recordingDriver,
  runnerConfig,
  startRunner,
  stopRunners,
} from './fixtures/runner.ts';
import { FakeTime } from './fixtures/time.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

const MIN = 60_000;

describe('the runner on the wire', () => {
  it('says what it can do, then resyncs with no runs and its hold, then beats with a sample', async () => {
    const server = await fakeServer();
    const { runner } = startRunner(server, { config: { slots: 3 } });
    expect(runner.status()).toEqual({
      connected: false,
      liveRuns: 0,
      backlog: 0,
      version: '0.1.0',
      holdUntil: null,
    });
    expect(await server.frames.next('runner.hello')).toEqual({
      type: 'runner.hello',
      protocol: 1,
      version: '0.1.0',
      caps: { harnesses: ['claude_code'], slots: 3, hold: 'none', power: [] },
    });
    expect(await server.frames.next('runner.resync')).toEqual({ type: 'runner.resync', runs: [] });
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'server',
    });
    const beat = await server.frames.next('runner.heartbeat');
    expect(beat).toMatchObject({ awakeMs: 0, load1: 0.5, liveRuns: [], backlog: 0 });
    expect(beat.sample).toMatchObject({ cpus: 8, liveRuns: 0 });
    expect(server.connections[0]).toEqual({
      authorization: `Bearer ${RUNNER_KEY}`,
      protocol: RUNNER_SUBPROTOCOL,
    });
    await vi.waitFor(() => expect(runner.status().connected).toBe(true));
  });

  it('announces the providers of its power executor and answers power commands through it', async () => {
    const server = await fakeServer();
    const power: PowerExecutor = {
      providers: ['airia_devbox'],
      execute: async () => ({ ok: true, status: 'running' }),
    };
    startRunner(server, { power });
    expect((await server.frames.next('runner.hello')).caps.power).toEqual(['airia_devbox']);
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({
      type: 'power.command',
      cmdId,
      target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
      action: 'status',
    });
    expect(await server.frames.next('power.result')).toEqual({
      type: 'power.result',
      cmdId,
      ok: true,
      status: 'running',
    });
  });

  it('samples once a minute in the 20-second heartbeats', async () => {
    const server = await fakeServer();
    const { time, sampler } = startRunner(server);
    await server.frames.next('runner.heartbeat');
    for (let beat = 0; beat < 6; beat++) {
      await server.ping();
      await time.advance(20_000);
    }
    const beats = await Promise.all(Array.from({ length: 6 }, () => server.frames.next('runner.heartbeat')));
    expect(beats.map((frame) => frame.sample !== undefined)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(sampler.taken).toHaveLength(3);
  });
});

describe('the defaults', () => {
  it("runs on the system clock and timers, ws's WebSocket, no power and a key kept in memory", async () => {
    const server = await fakeServer();
    const time = new FakeTime();
    const runner = createRunner({
      config: runnerConfig(httpOf(server), { machineId: server.machineId }),
      version: '0.1.0',
      log: memoryLog().log,
      hold: recordingDriver().driver,
      sampler: fakeSampler(time),
    });
    runner.start();
    try {
      expect((await server.frames.next('runner.hello')).caps.power).toEqual([]);
      const beat = await server.frames.next('runner.heartbeat');
      expect(Math.abs(beat.now - Date.now())).toBeLessThan(5_000);
      const cmdId = newId();
      server.send({ type: 'key.rotate', cmdId, runnerKey: ROTATED_KEY });
      expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId, ok: true });
      server.dropAll();
      await server.frames.next('runner.hello');
      expect(server.connections.at(-1)?.authorization).toBe(`Bearer ${ROTATED_KEY}`);
    } finally {
      await runner.stop();
    }
  });
});

describe('commands', () => {
  it('holds the machine on machine.hold: hold.state first, then the ack', async () => {
    const server = await fakeServer();
    const { runner, time, hold } = startRunner(server);
    await server.frames.next('hold.state');
    const until = time.now() + 45 * MIN;
    const cmdId = newId();
    server.send({ type: 'machine.hold', cmdId, until });
    expect(await server.frames.next('hold.state')).toEqual({ type: 'hold.state', until, source: 'server' });
    expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId, ok: true });
    const types = server.frames.all.map((frame) => frame.type);
    expect(types.lastIndexOf('hold.state')).toBeLessThan(types.indexOf('cmd.ack'));
    expect(hold.calls).toEqual([{ step: 'apply', until }]);
    expect(runner.status().holdUntil).toBe(until);
    server.send({ type: 'machine.hold', cmdId, until: null });
    await server.frames.next('cmd.ack');
    expect(hold.calls).toHaveLength(1);
  });

  it('fails power commands with no_power_driver and refuses the run commands and offers until S5', async () => {
    const server = await fakeServer();
    startRunner(server);
    await server.frames.next('runner.heartbeat');
    const power = newId();
    server.send({
      type: 'power.command',
      cmdId: power,
      target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
      action: 'start',
    });
    expect(await server.frames.next('power.result')).toEqual({
      type: 'power.result',
      cmdId: power,
      ok: false,
      error: 'no_power_driver',
    });
    const stop = newId();
    server.send({ type: 'run.stop', cmdId: stop, runId: newId(), mode: 'kill' });
    expect(await server.frames.next('cmd.ack')).toEqual({
      type: 'cmd.ack',
      cmdId: stop,
      ok: false,
      error: NO_RUNS,
    });
    const unknown = newId();
    server.sendRaw(JSON.stringify({ type: 'machine.reboot', cmdId: unknown }));
    expect(await server.frames.next('cmd.ack')).toMatchObject({ cmdId: unknown, ok: false });
    const offer = newId();
    server.send({ type: 'job.offer', id: offer, runId: newId(), agentId: newId(), expiresAt: 1 });
    expect(await server.frames.next('job.decline')).toMatchObject({ id: offer, reason: NO_RUNS });
  });

  it('saves a rotated key and uses it on the next connection', async () => {
    const server = await fakeServer();
    const { time, saved, config } = startRunner(server);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'key.rotate', cmdId, runnerKey: ROTATED_KEY });
    expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId, ok: true });
    expect(saved).toEqual([{ ...config, runnerKey: ROTATED_KEY }]);
    server.dropAll();
    await vi.waitFor(() => expect(time.pending).toContain(1_000));
    await time.advance(1_000);
    await server.frames.next('runner.hello');
    expect(server.connections.map((connection) => connection.authorization)).toEqual([
      `Bearer ${RUNNER_KEY}`,
      `Bearer ${ROTATED_KEY}`,
    ]);
  });

  it('keeps the old key when the new one cannot be saved, and drains on runner.drain', async () => {
    const server = await fakeServer();
    const { runner } = startRunner(server, { saveFails: true });
    await server.frames.next('runner.heartbeat');
    const rotate = newId();
    server.send({ type: 'key.rotate', cmdId: rotate, runnerKey: ROTATED_KEY });
    expect(await server.frames.next('cmd.ack')).toEqual({
      type: 'cmd.ack',
      cmdId: rotate,
      ok: false,
      error: 'disk full',
    });
    expect(runner.draining).toBe(false);
    const drain = newId();
    server.send({ type: 'runner.drain', cmdId: drain });
    expect(await server.frames.next('cmd.ack')).toMatchObject({ cmdId: drain, ok: true });
    expect(runner.draining).toBe(true);
  });
});

describe('the hold, sleeps and restarts', () => {
  it('holds while runs are live, reports it, and counts the runs in samples and health', async () => {
    const server = await fakeServer();
    const { runner, time } = startRunner(server);
    await server.frames.next('runner.heartbeat');
    await runner.setLiveRuns(2);
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'server',
    });
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: time.now() + LIVE_RUNS_HOLD_MS,
      source: 'live_runs',
    });
    expect(runner.status()).toMatchObject({ liveRuns: 2, holdUntil: time.now() + LIVE_RUNS_HOLD_MS });
    await runner.setLiveRuns(0);
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'live_runs',
    });
  });

  it('resyncs at once after the machine slept, before the heartbeat, and looks at the hold again', async () => {
    const server = await fakeServer();
    const { time, hold, logs } = startRunner(server);
    await server.frames.next('runner.resync');
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'machine.hold', cmdId, until: time.now() + 10 * MIN });
    await server.frames.next('cmd.ack');
    time.sleep(30 * MIN);
    await time.advance(20_000);
    await server.frames.next('runner.resync');
    await server.frames.next('runner.heartbeat');
    const after = server.frames.all.slice(-3).map((frame) => frame.type);
    expect(after).toEqual(['runner.resync', 'hold.state', 'runner.heartbeat']);
    expect(logs.messages()).toContain('the machine slept; resyncing');
    await vi.waitFor(() => expect(hold.calls.at(-1)).toEqual({ step: 'apply', until: null }));
    expect(await server.frames.next('hold.state', (frame) => frame.until === null)).toBeDefined();
  });

  it('survives a server restart: it reconnects and repeats the handshake with its current hold', async () => {
    const server = await fakeServer();
    const { time } = startRunner(server);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    await server.frames.next('runner.heartbeat');
    const until = time.now() + 30 * MIN;
    server.send({ type: 'machine.hold', cmdId: newId(), until });
    await server.frames.next('cmd.ack');
    await server.restart();
    await vi.waitFor(() => expect(time.pending).toContain(1_000));
    await time.advance(1_000);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    expect(await server.frames.next('hold.state', (frame) => frame.until === until)).toBeDefined();
    expect(server.frames.of('runner.hello')).toHaveLength(2);
  });

  it('warns when the server names another machine, and releases the hold when it stops', async () => {
    const server = await fakeServer();
    const { runner, logs, hold } = startRunner(server, { config: { machineId: newId() } });
    await server.frames.next('runner.heartbeat');
    expect(logs.messages('warn')).toContain('the server names another machine than runner.json');
    await runner.stop();
    expect((await runner.ended).reason).toBe('stopped');
    expect(hold.calls.at(-1)).toEqual({ step: 'close' });
    expect(runner.status().connected).toBe(false);
  });
});
