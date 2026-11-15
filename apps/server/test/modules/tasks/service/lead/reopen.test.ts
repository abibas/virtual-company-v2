import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld, ended } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { finish, taskRow } from '../../../../fixtures/runs.ts';
import { handOffNote } from '../../../../fixtures/tasks/reopen.ts';
import {
  historyOf,
  makeTask,
  moved,
  stepOf,
  type TaskDetailView,
  tasksPath,
} from '../../../../fixtures/tasks.ts';
import { leadTurn, toolCall, toolScene } from '../../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('the Lead’s task_route on a closed task (T-28)', () => {
  it('reopens it into the step asked with its reason, as a new round, the step’s agent told the correction', async () => {
    const s = await toolScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Approve').id,
    });
    await moved(w, s.c, s.c.owner, task.key, { action: 'approve' });
    const { start } = await leadTurn(w, s, 'T-1 is wrong: the login still fails.');
    const lead = (tool: string, input: Record<string, unknown>) =>
      toolCall(s.runner, start.turnId, tool, input);
    expect(await lead('task_route', { key: 'T-1', step: 'Develop' })).toMatchObject({
      ok: false,
      text: 'Say what is wrong: a reopen needs the correction',
    });
    expect(await lead('task_cancel', { key: 'T-1', reason: 'Not needed' })).toMatchObject({
      ok: false,
      text: 'The task is done',
    });
    expect((await taskRow(w.t.db, task.id)).state).toBe('done');

    expect(
      await lead('task_route', { key: 'T-1', step: 'develop', reason: 'The login still fails' }),
    ).toEqual(
      expect.objectContaining({ ok: true, text: 'Done: T-1 is now active at "Develop" (working), round 1.' }),
    );
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.prompt).toContain(
      'It was closed at "Approve", and is reopened with a correction: back with you for round 1.',
    );
    expect(develop.spec.prompt).toContain('Their reason and findings:\n> The login still fails');
    expect((await historyOf(w.t.db, task.id)).slice(-3)).toEqual([
      ['reopened', 'Approve', 'Develop', null],
      ['entered', null, 'Develop', 1],
      ['started', null, 'Develop', null],
    ]);
    const after = (await as(w, s.c.owner)('GET', tasksPath(s.c, '/T-1'))).body as TaskDetailView;
    expect(after).toMatchObject({ state: 'active', closedAt: null });
    expect(after.history.find((event) => event.kind === 'reopened')).toMatchObject({
      actor: { principalId: s.c.lead, kind: 'agent', name: 'DEVBOX Coordinator' },
      reason: 'The login still fails',
    });
    const note = await handOffNote(w.t.db, task.id, 'Approve');
    expect(note).toMatchObject({
      round: 1,
      createdBy: s.c.lead,
      text: '**Reopened:** The login still fails',
    });
    finish(s.runner, develop, 'Fixed.');
    await ended(w.t.db, develop.turnId);
  });

  it('reopens a cancelled task too, into a step that waits for a person', async () => {
    const s = await toolScene(w);
    const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id });
    await moved(w, s.c, s.c.owner, task.key, { action: 'cancel' });
    const { start } = await leadTurn(w, s);
    expect(
      await toolCall(s.runner, start.turnId, 'task_route', {
        key: 'T-1',
        step: 'Approve',
        reason: 'Needed after all',
      }),
    ).toMatchObject({
      ok: true,
      text: 'Done: T-1 is now active at "Approve" (waiting for a person), round 1.',
    });
    expect((await historyOf(w.t.db, task.id)).at(-2)).toEqual(['reopened', 'Approve', 'Approve', null]);
  });
});
