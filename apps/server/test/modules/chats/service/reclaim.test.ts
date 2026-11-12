import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CARRIED_ON } from '../../../../src/modules/tasks/rules/runs.ts';
import { seedTurns } from '../../../fixtures/chats/history.ts';
import {
  ANSWER,
  beginChat,
  type ChatsWorld,
  chatsWorld,
  ended,
  endTurn,
  eventRows,
  eventually,
  type Scene,
  scene,
  sendEvents,
  sendPrompt,
  startedTurn,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { finish, type RunScene, runScene, stepStateIs, taskRow } from '../../../fixtures/runs.ts';
import { act, historyOf, makeTask, stepOf } from '../../../fixtures/tasks.ts';

/**
 * A late re-attach (2026-11-12, `service/reclaim.ts`): a runner that comes back after the grace with a turn the server
 * already failed because it was away gets the turn back while nothing else started in its chat, its task (blocked by
 * that failure, unmoved) carrying on; otherwise the turn stays failed and the runner hears it is gone. On PGlite with
 * `FakeRunner`, the grace shortened to 300 ms.
 */

const KEEPS = { reattach: true } as const;
const UNREACHABLE = /^machine_disconnected: .+ was unreachable for under a second: the turn stopped\.$/;

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld({ turnGraceMs: 300 });
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

/** The runner's link drops and stays down past the grace: the turn fails. */
async function awayTooLong(runner: FakeRunner, turnId: string) {
  await runner.disconnect();
  expect(await ended(w.t.db, turnId)).toMatchObject({
    status: 'failed',
    error: expect.stringMatching(UNREACHABLE),
  });
}

/** The runner comes back holding the turn: what the server answers for it. */
async function comeBackWith(runner: FakeRunner, turnId: string, lastSeq = 0) {
  runner.turns = [{ turnId, lastSeq, ended: false }];
  await runner.connect();
  return (await runner.frames.next('turn.resume')).turns;
}

/** A Develop task whose first turn started; its turn's start. */
async function developing(s: RunScene) {
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const start = await s.runner.frames.next('turn.start');
  return { task, start };
}

describe('a chat turn its runner comes back with after the grace', () => {
  it('goes on where the stored events stop, and ends as any turn', async () => {
    const s: Scene = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const start = await startedTurn(w, s);
    sendEvents(runner, start.turnId, ANSWER.slice(0, 2));
    await eventually('two events stored', async () => (await eventRows(w.t.db, start.turnId)).length === 2);
    await awayTooLong(runner, start.turnId);
    expect(await comeBackWith(runner, start.turnId, 4)).toEqual([{ turnId: start.turnId, lastSeq: 2 }]);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({
      status: 'running',
      error: null,
      endedAt: null,
    });
    sendEvents(runner, start.turnId, ANSWER);
    endTurn(runner, start.turnId);
    expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'done', resultText: '4' });
    expect((await eventRows(w.t.db, start.turnId)).map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    expect(await runner.frames.next('turn.ack')).toEqual({ type: 'turn.ack', turnId: start.turnId });
  });

  it('stays failed once another turn started in its chat, and its runner hears it is gone', async () => {
    const s: Scene = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const start = await startedTurn(w, s);
    await awayTooLong(runner, start.turnId);
    await seedTurns(w, s, ['message'], 2);
    expect(await comeBackWith(runner, start.turnId)).toEqual([{ turnId: start.turnId, lastSeq: null }]);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({ status: 'failed' });
  });

  it('counts as running for its machine’s slots once taken back', async () => {
    const s: Scene = await scene(w, { caps: { ...KEEPS, slots: 1 } });
    const runner = s.runner as FakeRunner;
    const start = await startedTurn(w, s);
    await awayTooLong(runner, start.turnId);
    await comeBackWith(runner, start.turnId);
    const other = await beginChat(w, s.company, s.agentId);
    const res = await sendPrompt(w, { company: s.company, chat: other }, 'Meanwhile');
    expect(res.body).toMatchObject({ status: 'queued', machineWait: 'slots' });
    endTurn(runner, start.turnId);
    expect((await runner.frames.next('turn.start')).turnId).toBe((res.body as { id: string }).id);
  });

  it('stays failed when it ended any other way', async () => {
    const s: Scene = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const start = await startedTurn(w, s);
    endTurn(runner, start.turnId, { ok: false, exitCode: 1, error: 'process_lost' });
    await ended(w.t.db, start.turnId);
    await runner.disconnect();
    expect(await comeBackWith(runner, start.turnId)).toEqual([{ turnId: start.turnId, lastSeq: null }]);
  });
});

describe("a task step's turn its runner comes back with after the grace", () => {
  it('undoes the block its failure caused, and the task carries on at its step', async () => {
    const s = await runScene(w, { caps: KEEPS });
    const { task, start } = await developing(s);
    await awayTooLong(s.runner, start.turnId);
    await stepStateIs(w.t.db, task.id, 'blocked');
    expect(await comeBackWith(s.runner, start.turnId)).toEqual([{ turnId: start.turnId, lastSeq: 0 }]);
    expect(await taskRow(w.t.db, task.id)).toMatchObject({ stepState: 'working', blockedReason: null });
    expect((await historyOf(w.t.db, task.id)).slice(-2)).toEqual([
      ['blocked', null, 'Develop', 1],
      ['started', null, 'Develop', 1],
    ]);
    finish(s.runner, start, 'Done.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({ status: 'done' });
  });

  it('stays failed, its row as it was, when the task moved since', async () => {
    const s = await runScene(w, { caps: KEEPS });
    const { task, start } = await developing(s);
    await awayTooLong(s.runner, start.turnId);
    await stepStateIs(w.t.db, task.id, 'blocked');
    const before = await turnRow(w.t.db, start.turnId);
    expect((await act(w, s.c, s.c.owner, task.key, { action: 'cancel' })).status).toBe(200);
    expect(await comeBackWith(s.runner, start.turnId)).toEqual([{ turnId: start.turnId, lastSeq: null }]);
    expect(await turnRow(w.t.db, start.turnId)).toEqual(before);
    expect(await taskRow(w.t.db, task.id)).toMatchObject({ state: 'cancelled' });
  });

  it('names the history row it carries on with', () => {
    expect(CARRIED_ON).toBe('The machine came back with the turn; it goes on');
  });
});
