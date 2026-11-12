import type { TenantDb } from '@mwc/db';
import { captureLogger, TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { taskTurnHook } from '../../../../src/modules/tasks/index.ts';
import { type ChatsWorld, chatPath, chatsWorld, ended } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { textsOf } from '../../../fixtures/notifications.ts';
import {
  artifactsOf,
  conversationsOf,
  endTurn,
  finish,
  runScene,
  sendEvents,
  stepStateIs,
  taskRow,
} from '../../../fixtures/runs.ts';
import { historyOf, makeTask, moved, stepOf, taskNotices } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A scene with a task at Develop and its first turn started. */
async function atDevelop(options: Parameters<typeof runScene>[1] = {}) {
  const s = await runScene(w, options);
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const start = await s.runner.frames.next('turn.start');
  return { ...s, task, start };
}

describe('a step’s turn ends', () => {
  it('ended without a hand-off: the reply is the round’s hand-off note, and the Lead’s person is told', async () => {
    const s = await atDevelop();
    finish(s.runner, s.start, 'Fixed on branch fix-login.');
    const row = await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    expect(row.blockedReason).toBeNull();
    expect((await historyOf(w.t.db, s.task.id)).at(-1)).toEqual(['turn_ended', null, 'Develop', 1]);
    const [note] = await artifactsOf(w.t.db, s.task.id);
    expect(note).toMatchObject({
      name: 'hand-off note',
      kind: 'note',
      stepName: 'Develop',
      round: 1,
      contentType: 'text/markdown; charset=utf-8',
      size: 26,
      turnId: s.start.turnId,
      createdBy: s.c.developer,
    });
    expect(new TextDecoder().decode(note?.bytes as Uint8Array)).toBe('Fixed on branch fix-login.');
    expect(await taskNotices(w.t.db, s.c.companyId)).toEqual([[s.c.manager.principalId, 'task_turn_ended']]);
    expect(await textsOf(w, s.c, s.c.manager)).toEqual([
      'Developer ended its turn on T-1 “Fix the login” at Develop; nobody has moved it on yet',
    ]);
  });

  it('a failed turn blocks the task with its error in words; a stopped one ends without a hand-off', async () => {
    const s = await atDevelop();
    sendEvents(s.runner, s.start.turnId, [{ type: 'session', sessionId: 'b4c1f0e2-session' }]);
    endTurn(s.runner, s.start.turnId, { ok: false, exitCode: 1, error: 'spawn_failed: no claude here' });
    const row = await stepStateIs(w.t.db, s.task.id, 'blocked');
    expect(row.blockedReason).toBe('The harness did not start on This Mac (no claude here)');
    expect((await historyOf(w.t.db, s.task.id)).at(-1)).toEqual(['blocked', null, 'Develop', 1]);
    expect(await taskNotices(w.t.db, s.c.companyId)).toEqual([[s.c.manager.principalId, 'task_blocked']]);
    expect(await artifactsOf(w.t.db, s.task.id)).toEqual([]);
    await moved(w, s.c, s.c.manager, s.task.key, { action: 'start' });
    const again = await s.runner.frames.next('turn.start');
    endTurn(s.runner, again.turnId, { ok: false, exitCode: null, error: 'stopped' });
    expect((await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff')).blockedReason).toBeNull();
  });

  it('a turn that ends after the task moved on changes nothing but keeps its note', async () => {
    const s = await atDevelop();
    const res = await moved(w, s.c, s.c.manager, s.task.key, { action: 'hand_on', force: true });
    expect(res.task).toMatchObject({ step: { name: 'Code review' }, stepState: 'working' });
    await s.runner.frames.next('turn.stop', (frame) => frame.turnId === s.start.turnId);
    const review = await s.runner.frames.next('turn.start');
    finish(s.runner, s.start, 'Stopped half way.');
    await ended(w.t.db, s.start.turnId);
    await expect
      .poll(async () => (await artifactsOf(w.t.db, s.task.id)).map((a) => [a.stepName, a.name]))
      .toEqual([['Develop', 'hand-off note']]);
    expect((await taskRow(w.t.db, s.task.id)).stepState).toBe('working');
    finish(s.runner, review, 'PASS');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
  });
});

describe('a person replies in the step’s conversation', () => {
  it('works on the task again, by them, and its end leaves it for a person again', async () => {
    const s = await atDevelop();
    finish(s.runner, s.start, 'Which branch?');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    const [chat] = await conversationsOf(w.t.db, s.task.id);
    const sent = await as(w, s.c.owner)('POST', chatPath(s.c, chat?.id as string, '/turns'), {
      prompt: 'main',
    });
    expect(sent.status).toBe(202);
    const reply = await s.runner.frames.next('turn.start');
    expect(reply.spec).toMatchObject({
      prompt: 'main',
      sessionId: 'b4c1f0e2-session',
      artifacts: { dir: 'tasks/T-1/artifacts/1-develop/round-1' },
    });
    expect((await taskRow(w.t.db, s.task.id)).stepState).toBe('working');
    const history = await historyOf(w.t.db, s.task.id);
    expect(history.at(-1)).toEqual(['started', null, 'Develop', null]);
    finish(s.runner, reply, 'Done on main.');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    const notes = (await artifactsOf(w.t.db, s.task.id)).filter((a) => a.kind === 'note');
    expect(notes.map((a) => [a.round, new TextDecoder().decode(a.bytes as Uint8Array)])).toEqual([
      [1, 'Done on main.'],
    ]);
    expect((sent.body as ChatTurnView).createdBy).toBe(s.c.owner.principalId);
  });

  it('a reply in an older conversation that ends while the round’s turn runs leaves the task worked on', async () => {
    const s = await runScene(w, { reviewReturns: 'fresh' });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    finish(s.runner, await s.runner.frames.next('turn.start'), 'SEND BACK', 'review-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'send_back', reason: 'Tests fail' });
    finish(s.runner, await s.runner.frames.next('turn.start'), 'Fixed.', 'develop-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    const round2 = await s.runner.frames.next('turn.start');
    const old = (await conversationsOf(w.t.db, task.id)).find(
      (chat) => chat.taskRound === 1 && chat.sessionId === 'review-1',
    );
    await as(w, s.c.owner)('POST', chatPath(s.c, old?.id as string, '/turns'), { prompt: 'Why?' });
    const reply = await s.runner.frames.next('turn.start');
    finish(s.runner, reply, 'Because.', 'review-1');
    await ended(w.t.db, reply.turnId);
    await expect.poll(async () => (await artifactsOf(w.t.db, task.id)).length).toBe(3);
    expect((await taskRow(w.t.db, task.id)).stepState).toBe('working');
    finish(s.runner, round2, 'PASS', 'review-2');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
  });
});

describe('the hook itself', () => {
  it('logs its own failures by task and turn, and never throws', async () => {
    const TASK = '019a7b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c';
    const { logger, lines } = captureLogger();
    const hook = taskTurnHook({ logger, db: w.t.db });
    const broken = {} as TenantDb;
    const turn = {
      taskId: TASK,
      stepId: 'step-1',
      chatId: 'chat-1',
      agentPrincipalId: 'agent-1',
      turnId: 'turn-1',
      round: 1,
      artifactsDir: 'tasks/T-1/artifacts/1-develop/round-1',
    };
    await expect(hook.prepare(broken, turn)).resolves.toBeUndefined();
    await expect(
      hook.ended(broken, turn, { status: 'done', resultText: 'x', error: null }),
    ).resolves.toBeUndefined();
    expect(lines.filter((line) => String(line.msg).startsWith("tasks: a step's run could not"))).toEqual([
      expect.objectContaining({
        taskId: TASK,
        turnId: 'turn-1',
        msg: "tasks: a step's run could not plan its turn",
      }),
      expect.objectContaining({
        taskId: TASK,
        turnId: 'turn-1',
        msg: "tasks: a step's run could not record its end",
      }),
    ]);
  });
});
