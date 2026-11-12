import { type ChatTurn, tenant } from '@mwc/db';
import { captureLogger } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_RESTARTED } from '../../../../src/modules/chats/index.ts';
import { failLeftTurns } from '../../../../src/modules/chats/service/adopt.ts';
import { chatsLive } from '../../../../src/modules/chats/service/live.ts';
import type { CredentialsForHarness } from '../../../../src/modules/credentials/index.ts';
import { taskTurnHook } from '../../../../src/modules/tasks/index.ts';
import { detailOf, queued, sendWith } from '../../../fixtures/chats/queue.ts';
import { restartedServer } from '../../../fixtures/chats/restart.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  eventRows,
  eventually,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { runScene, stepStateIs, taskRow } from '../../../fixtures/runs.ts';
import { historyOf, makeTask, stepOf } from '../../../fixtures/tasks.ts';

/**
 * Turns that survive restarts, the server's side (S5.4): a dropped link leaves a turn running and detached for the
 * grace, a reconnect within it resumes the turn where the server's events stop, a restarted server takes a turn back
 * from the runner's hello, and the grace running out fails the turn in words naming the machine (its task blocked
 * once). A runner coming back after the grace is `reclaim.test.ts`'s. On PGlite with `FakeRunner`.
 */

const KEEPS = { reattach: true } as const;

let w: ChatsWorld;
let quick: ChatsWorld;
beforeAll(async () => {
  [w, quick] = await Promise.all([chatsWorld(), chatsWorld({ turnGraceMs: 300 })]);
});
afterEach(async () => {
  await Promise.all([w.disconnectAll(), quick.disconnectAll()]);
});
afterAll(async () => {
  await Promise.all([w.close(), quick.close()]);
});

/** Drops the runner's link and waits until the server saw it. */
async function drop(world: ChatsWorld, s: Scene) {
  await (s.runner as FakeRunner).disconnect();
  await eventually('the runner is gone', () => !world.hub.isOnline(s.machineId));
  await world.hub.idle();
}

/** The runner comes back holding `turns`. */
async function comeBack(s: Scene, turns: FakeRunner['turns']) {
  const runner = s.runner as FakeRunner;
  runner.turns = turns;
  await runner.connect();
  return runner;
}

describe('a turn whose runner keeps it (caps.reattach)', () => {
  it('stays running and detached when the link drops, and resumes on a reconnect: what follows the last stored event, each once', async () => {
    const s = await scene(w, { caps: KEEPS });
    const start = await startedTurn(w, s);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER.slice(0, 2));
    await eventually('two events stored', async () => (await eventRows(w.t.db, start.turnId)).length === 2);
    await drop(w, s);
    expect((await turnRow(w.t.db, start.turnId))?.status).toBe('running');
    expect((await detailOf(w, s)).turns.at(-1)).toMatchObject({
      id: start.turnId,
      detached: true,
      detachedAt: w.clock().toISOString(),
    });
    expect(w.hub.live(s.machineId).turns).toBe(1);
    const runner = await comeBack(s, [{ turnId: start.turnId, lastSeq: 4, ended: true }]);
    expect(await runner.frames.next('turn.resume')).toEqual({
      type: 'turn.resume',
      turns: [{ turnId: start.turnId, lastSeq: 2 }],
    });
    sendEvents(runner, start.turnId, ANSWER);
    endTurn(runner, start.turnId);
    expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'done', resultText: '4' });
    expect((await eventRows(w.t.db, start.turnId)).map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    expect(await runner.frames.next('turn.ack')).toEqual({ type: 'turn.ack', turnId: start.turnId });
    expect((await detailOf(w, s)).turns.at(-1)).not.toHaveProperty('detached');
  });

  it('ends a waiting turn its runner’s next hello leaves out, and says null for a turn the server does not have', async () => {
    const s = await scene(w, { caps: KEEPS });
    const start = await startedTurn(w, s);
    await drop(w, s);
    const unknown = '019a0000-0000-7000-8000-00000000abcd';
    const runner = await comeBack(s, [{ turnId: unknown, lastSeq: 3, ended: false }]);
    expect((await runner.frames.next('turn.resume')).turns).toEqual([{ turnId: unknown, lastSeq: null }]);
    expect(await ended(w.t.db, start.turnId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^machine_disconnected: .+ came back without this turn: it stopped there/),
    });
  });

  it('ends at once when stopped while it waits (2026-11-12), and its runner coming back with it hears it is gone', async () => {
    const s = await scene(w, { caps: KEEPS });
    const start = await startedTurn(w, s);
    await drop(w, s);
    const stop = await as(w, s.company.owner)(
      'POST',
      chatPath(s.company, s.chat.id, `/turns/${start.turnId}/stop`),
    );
    expect(stop.status).toBe(202);
    expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'stopped' });
    const runner = await comeBack(s, [{ turnId: start.turnId, lastSeq: 0, ended: false }]);
    expect((await runner.frames.next('turn.resume')).turns).toEqual([
      { turnId: start.turnId, lastSeq: null },
    ]);
    expect(runner.frames.of('turn.stop')).toEqual([]);
  });

  it('starts no second turn in its chat while it waits: a message queues, and starts once the turn ended', async () => {
    const s = await scene(w, { caps: KEEPS });
    const start = await startedTurn(w, s);
    await drop(w, s);
    const plain = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'x',
    });
    expect([plain.status, (plain.body as { error: { code: string } }).error.code]).toEqual([
      409,
      'turn_running',
    ]);
    const next = await queued(w, s, 'And 3 + 3?');
    expect((await sendWith(w, s, 'And 4 + 4?', 'after')).status).toBe(202);
    const runner = await comeBack(s, [{ turnId: start.turnId, lastSeq: 0, ended: true }]);
    await runner.frames.next('turn.resume');
    expect(runner.frames.of('turn.start')).toHaveLength(1);
    endTurn(runner, start.turnId);
    expect((await runner.frames.next('turn.start')).turnId).toBe(next.id);
  });

  it('is taken back by a restarted server from its runner’s hello, its events going on from the stored ones', async () => {
    const s = await scene(w, { caps: KEEPS });
    const start = await startedTurn(w, s);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER.slice(0, 1));
    await eventually('the session stored', async () => (await eventRows(w.t.db, start.turnId)).length === 1);
    await drop(w, s);
    const next = await restartedServer(w);
    try {
      const turns = [{ turnId: start.turnId, lastSeq: 4, ended: true }];
      const runner = await next.connect(s.runnerKey, {
        caps: { ...(s.runner as FakeRunner).hello.caps },
        turns,
      });
      expect((await runner.frames.next('turn.resume')).turns).toEqual([{ turnId: start.turnId, lastSeq: 1 }]);
      sendEvents(runner, start.turnId, ANSWER.slice(1), 2);
      endTurn(runner, start.turnId);
      expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'done', resultText: '4' });
      expect((await turnRow(w.t.db, start.turnId))?.usage).toMatchObject({ inputTokens: 12 });
      expect(await runner.frames.next('turn.ack')).toEqual({ type: 'turn.ack', turnId: start.turnId });
    } finally {
      await next.close();
    }
  });
});

describe('the grace (S5.4)', () => {
  it('fails a waiting turn when it runs out, and blocks its task once', async () => {
    const s = await runScene(quick, { caps: KEEPS });
    const task = await makeTask(quick, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    await s.runner.disconnect();
    const words = /^.+ was unreachable for under a second: the turn stopped\.$/;
    expect(await ended(quick.t.db, start.turnId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(new RegExp(`^machine_disconnected: ${words.source.slice(1)}`)),
    });
    // The task says the words, without the code.
    expect(await stepStateIs(quick.t.db, task.id, 'blocked')).toMatchObject({
      blockedReason: expect.stringMatching(words),
    });
    expect((await historyOf(quick.t.db, task.id)).filter(([kind]) => kind === 'blocked')).toHaveLength(1);
  });

  it('makes a turn stopped when a stop was asked while it waited', async () => {
    const s = await scene(quick, { caps: KEEPS });
    const start = await startedTurn(quick, s);
    await drop(quick, s);
    await as(quick, s.company.owner)('POST', chatPath(s.company, s.chat.id, `/turns/${start.turnId}/stop`));
    expect(await ended(quick.t.db, start.turnId)).toMatchObject({ status: 'stopped' });
  });
});

describe('failLeftTurns (S5.4)', () => {
  it('ends the running turns a stopped server left that no runner took back, blocking their task', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const { logger, lines } = captureLogger();
    const tasks = taskTurnHook({ logger, db: w.t.db });
    // A restarted server's live turns: it holds none of them.
    const live = chatsLive({ logger, clock: w.clock, credentials: {} as CredentialsForHarness, tasks });
    const after = new Date(w.clock().getTime() + 1);
    expect(await failLeftTurns({ db: w.t.db, logger, live, tasks }, after)).toBeGreaterThanOrEqual(1);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({ status: 'failed', error: SERVER_RESTARTED });
    expect(await taskRow(w.t.db, task.id)).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'The server restarted during the turn',
    });
    expect(lines.some((line) => line.msg === 'failed the chat turns a stopped server left running')).toBe(
      true,
    );
  });

  it('leaves the turns this process holds, and those that started after it began', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    const { logger } = captureLogger();
    const row = (await turnRow(w.t.db, start.turnId)) as ChatTurn;
    const own = chatsLive({ logger, clock: w.clock, credentials: {} as CredentialsForHarness });
    const used = { credentialId: '', ownerUserId: '', kind: 'claude_setup_token' } as const;
    own.sink(await tenant(w.t.db, s.company.companyId), row, used);
    await failLeftTurns({ db: w.t.db, logger, live: own }, new Date(w.clock().getTime() + 1));
    expect((await turnRow(w.t.db, start.turnId))?.status).toBe('running');
    const fresh = chatsLive({ logger, clock: w.clock, credentials: {} as CredentialsForHarness });
    expect(await failLeftTurns({ db: w.t.db, logger, live: fresh }, w.clock())).toBe(0);
    expect((await turnRow(w.t.db, start.turnId))?.status).toBe('running');
  });
});
