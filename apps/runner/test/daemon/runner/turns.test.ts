import { readdirSync } from 'node:fs';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RUNS_HOLD_MS } from '../../../src/hold/manager.ts';
import { askRoot, testAskHost } from '../../fixtures/ask.ts';
import { cleanUpLinks, fakeServer } from '../../fixtures/link.ts';
import { memoryLog } from '../../fixtures/log.ts';
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

  it('offers the agents’ tools only with the runner’s own tools and a way to start processes', async () => {
    const server = await fakeServer();
    const { host, root } = fakeHarnessHost();
    startRunner(server, { harness: host, spawn: new FakeSpawn() });
    expect((await server.frames.next('runner.hello')).caps.agentTools).toBe(false);
    const tooled = await fakeServer();
    const ask = testAskHost(memoryLog().log, askRoot(root));
    startRunner(tooled, { harness: { ...host, ask }, spawn: new FakeSpawn() });
    expect((await tooled.frames.next('runner.hello')).caps.agentTools).toBe(true);
    const idle = await fakeServer();
    startRunner(idle, { harness: { ...host, ask } });
    expect((await idle.frames.next('runner.hello')).caps.agentTools).toBe(false);
  });

  it('says caps.github (S7.1d) only with its git hooks’ folder and a way to start processes', async () => {
    const server = await fakeServer();
    const { host, root } = fakeHarnessHost();
    startRunner(server, { harness: host, spawn: new FakeSpawn() });
    expect((await server.frames.next('runner.hello')).caps.github).toBe(false);
    const hooked = await fakeServer();
    const gitHooks = `${root}/state/git-hooks`;
    startRunner(hooked, { harness: { ...host, gitHooks }, spawn: new FakeSpawn() });
    expect((await hooked.frames.next('runner.hello')).caps.github).toBe(true);
    const idle = await fakeServer();
    startRunner(idle, { harness: { ...host, gitHooks } });
    expect((await idle.frames.next('runner.hello')).caps.github).toBe(false);
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

  it('keeps its turns through a dropped link, names them in its next hello and resumes where the server says', async () => {
    const server = await fakeServer({ resume: true });
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn();
    const { time } = startRunner(server, { harness: host, spawn });
    expect((await server.frames.next('runner.hello')).caps.reattach).toBe(true);
    await server.frames.next('runner.heartbeat');
    const turnId = newId();
    server.send({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(spawn.calls).toHaveLength(1));
    server.dropAll();
    await vi.waitFor(() => expect(time.pending).toContain(1_000));
    spawn.calls[0]?.child.finish(answerLines('4'), 0);
    await time.advance(1_000);
    expect(spawn.groupKills).toEqual([]);
    expect((await server.frames.next('runner.hello')).turns).toEqual([{ turnId, lastSeq: 3, ended: true }]);
    server.send({ type: 'turn.resume', turns: [{ turnId, lastSeq: 1 }] });
    const resent = await server.frames.next('turn.events');
    expect(resent.events.map((item) => item.seq)).toEqual([2, 3]);
    expect(await server.frames.next('turn.end')).toMatchObject({ turnId, ok: true, exitCode: 0 });
    server.send({ type: 'turn.ack', turnId });
    await vi.waitFor(() => expect(readdirSync(host.runs)).toEqual([]));
  });

  it('leaves its turns running when it stops: no signal, no end, its line let go', async () => {
    const server = await fakeServer({ resume: true });
    const { host, cwd } = fakeHarnessHost({ driver: { liveInput: true } });
    const spawn = new FakeSpawn();
    const { runner } = startRunner(server, { harness: host, spawn });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(spawn.calls).toHaveLength(1));
    await runner.stop();
    expect(spawn.groupKills).toEqual([]);
    expect([spawn.calls[0]?.child.released, spawn.calls[0]?.child.inputClosed]).toEqual([true, false]);
    expect(server.frames.of('turn.end')).toEqual([]);
  });

  it('forgets its turns on a server that takes no turn back: stopped, nothing sent', async () => {
    const server = await fakeServer();
    const { host, cwd } = fakeHarnessHost();
    const spawn = new FakeSpawn();
    const { time } = startRunner(server, { harness: host, spawn });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(spawn.calls).toHaveLength(1));
    server.dropAll();
    await vi.waitFor(() => expect(time.pending).toContain(1_000));
    expect(spawn.groupKills).toEqual([]);
    await time.advance(1_000);
    await server.frames.next('runner.hello');
    await vi.waitFor(() => expect(spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGINT']));
    await vi.waitFor(() => expect(readdirSync(host.runs)).toEqual([]));
    expect(server.frames.of('turn.end')).toEqual([]);
  });
});
