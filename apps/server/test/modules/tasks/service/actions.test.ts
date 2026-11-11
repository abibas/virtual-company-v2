import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld, ended } from '../../../fixtures/chats/world.ts';
import { finish, runScene, taskRow } from '../../../fixtures/runs.ts';
import { act, historyOf, makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const codeOf = (res: { body: unknown }) => (res.body as { error?: { code: string } }).error?.code;

describe('moving a task while its step’s turn runs', () => {
  it('is refused with step_running, after the caller’s own checks', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    await s.runner.frames.next('turn.start');
    expect(codeOf(await act(w, s.c, s.c.viewer, task.key, { action: 'hand_on' }))).toBe('forbidden');
    expect(codeOf(await act(w, s.c, s.c.member, task.key, { action: 'hand_on' }))).toBe('not_your_step');
    expect(codeOf(await act(w, s.c, s.c.manager, task.key, { action: 'pass' }))).toBe('wrong_kind');
    for (const body of [
      { action: 'hand_on' },
      { action: 'cancel' },
      { action: 'route', toStepId: stepOf(s.flow, 'Approve').id },
      { action: 'hand_on', force: false },
    ]) {
      const res = await act(w, s.c, s.c.manager, task.key, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([409, 'step_running']);
    }
    expect((await taskRow(w.t.db, task.id)).stepState).toBe('working');
    expect(s.runner.frames.of('turn.stop')).toEqual([]);
  });

  it('with force, stops the turn and moves the task; the turn’s end then leaves the task alone', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const res = await moved(w, s.c, s.c.manager, task.key, {
      action: 'cancel',
      reason: 'Wrong ticket',
      force: true,
    });
    expect(res).toMatchObject({ outcome: 'cancelled', task: { state: 'cancelled', stepState: null } });
    expect(await s.runner.frames.next('turn.stop')).toEqual({ type: 'turn.stop', turnId: start.turnId });
    finish(s.runner, start, 'Stopped.');
    await ended(w.t.db, start.turnId);
    expect((await taskRow(w.t.db, task.id)).state).toBe('cancelled');
    expect((await historyOf(w.t.db, task.id)).at(-1)).toEqual(['cancelled', 'Develop', null, null]);
  });

  it('needs no force once the turn ended', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    finish(s.runner, start, 'Done.');
    await ended(w.t.db, start.turnId);
    const res = await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    expect(res.task).toMatchObject({ step: { name: 'Code review' }, stepState: 'working' });
  });
});
