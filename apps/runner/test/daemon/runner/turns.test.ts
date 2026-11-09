import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RUNS_HOLD_MS } from '../../../src/hold/manager.ts';
import { cleanUpLinks, fakeServer } from '../../fixtures/link.ts';
import { startRunner, stopRunners } from '../../fixtures/runner.ts';
import { FakeSpawn } from '../../fixtures/spawn.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost } from '../../fixtures/turns.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

describe("the runner's chat turns on the wire", () => {
  it('says its harnesses, runs a turn and sends its events and end', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn().when(FAKE_COMMAND, (child) => child.finish(answerLines('4'), 0));
    startRunner(server, { harness: host, spawn });
    expect((await server.frames.next('runner.hello')).caps.harnesses).toEqual({
      claude_code: '2.1.319 (Claude Code)',
      codex: null,
    });
    await server.frames.next('runner.heartbeat');
    const turnId = newId();
    server.send({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
    const events = await server.frames.next('turn.events');
    expect(events.events.map((item) => item.event.type)).toEqual(['session', 'text', 'result']);
    expect(await server.frames.next('turn.end')).toEqual({ type: 'turn.end', turnId, ok: true, exitCode: 0 });
  });

  it('has no harness without a way to start processes, and answers every start unsupported', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    startRunner(server, { harness: host });
    expect((await server.frames.next('runner.hello')).caps.harnesses).toEqual({
      claude_code: null,
      codex: null,
    });
    await server.frames.next('runner.heartbeat');
    const turnId = newId();
    server.send({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
    expect(await server.frames.next('turn.end')).toMatchObject({ turnId, ok: false, error: 'unsupported' });
  });

  it('holds the machine while a turn is live, counted with the runs, and lets go when it ends', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn();
    const { runner, time } = startRunner(server, { harness: host, spawn });
    await server.frames.next('runner.heartbeat');
    await server.frames.next('hold.state');
    server.send({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('claude_code', { cwd }) });
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: time.now() + LIVE_RUNS_HOLD_MS,
      source: 'live_runs',
    });
    await runner.setLiveRuns(2);
    expect(runner.status().liveRuns).toBe(3);
    await runner.setLiveRuns(0);
    expect(runner.status().liveRuns).toBe(1);
    spawn.calls[0]?.child.finish(answerLines(), 0);
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'live_runs',
    });
    expect(runner.status().liveRuns).toBe(0);
  });

  it('stops its turns when the link drops', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn();
    startRunner(server, { harness: host, spawn });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(spawn.calls).toHaveLength(1));
    server.dropAll();
    await vi.waitFor(() => expect(spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGINT']));
  });

  it('ends its turns when it stops, telling the server before the socket closes', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn();
    const { runner } = startRunner(server, { harness: host, spawn });
    await server.frames.next('runner.heartbeat');
    const turnId = newId();
    server.send({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(spawn.calls).toHaveLength(1));
    await runner.stop();
    expect(await server.frames.next('turn.end')).toEqual({
      type: 'turn.end',
      turnId,
      ok: false,
      exitCode: null,
      error: 'runner_stopping',
    });
  });
});
