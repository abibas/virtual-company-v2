import { tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld, ended } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { roomRows } from '../../../../fixtures/room.ts';
import { eventually, finish, taskRow } from '../../../../fixtures/runs.ts';
import { closedAtReview, handOffNote, said } from '../../../../fixtures/tasks/reopen.ts';
import { sprintIdOf, sprintRows } from '../../../../fixtures/tasks/sprints.ts';
import {
  historyOf,
  makeTask,
  moved,
  stepOf,
  type TaskDetailView,
  tasksPath,
} from '../../../../fixtures/tasks.ts';
import { toolCall, toolScene } from '../../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const REASON = 'Empty passwords still pass';
const FINDINGS = 'login.ts line 12 accepts "".';

describe('the conversation a task was closed in (T-28)', () => {
  it('gets task_read and task_reopen with a standing line; the task’s other conversations do not', async () => {
    const s = await toolScene(w);
    const closed = await closedAtReview(w, s);
    const review = await said(w, s, closed.review, 'The login still fails.');
    expect(review.spec.tools).toEqual(['task_read', 'task_reopen']);
    expect(review.spec.instructions).toContain(
      '## This task is closed (from Most Wanted)\n\nT-1 is done. If the person says here that it is wrong or asks ' +
        'for a change to it, call task_reopen',
    );
    expect(review.spec.instructions).toContain('Never make the correction yourself');
    const read = await toolCall(s.runner, review.turnId, 'task_read');
    expect(read).toMatchObject({ ok: true, text: expect.stringMatching(/^# T-1 · Fix the login/) });
    expect(await toolCall(s.runner, review.turnId, 'task_reopen', { findings: FINDINGS })).toMatchObject({
      ok: false,
      text: expect.stringContaining('task_reopen did nothing; fix its input and call it again'),
    });
    finish(s.runner, review, 'Noted.');
    await ended(w.t.db, review.turnId);

    const develop = await said(w, s, closed.develop, 'Is it done?');
    expect(develop.spec.tools).toEqual(['task_read', 'task_hand_on', 'task_attach', 'task_blocked']);
    expect(develop.spec.instructions ?? '').not.toContain('This task is closed');
    expect(
      await toolCall(s.runner, develop.turnId, 'task_reopen', { reason: REASON, findings: FINDINGS }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        text:
          'The task was not closed at your step: only the conversation it was closed in reopens it. Nothing was ' +
          'recorded.',
      }),
    );
    finish(s.runner, develop, 'It is done.');
    await ended(w.t.db, develop.turnId);
    expect(await taskRow(w.t.db, closed.task.id)).toMatchObject({ state: 'done', decision: null });
  });

  // A closed task holds the reopen decision until the turn ends (migration 0050; before it, tasks_decision_check let
  // only an active task hold one, and every task_reopen failed on the server).
  it('task_reopen is recorded, and when the turn ends the task goes back to Develop for a new round', async () => {
    const s = await toolScene(w);
    const closed = await closedAtReview(w, s);
    const sprint = await sprintIdOf(w.t.db, closed.task.id);
    const review = await said(w, s, closed.review, `${REASON}: ${FINDINGS}`);
    const answer = await toolCall(s.runner, review.turnId, 'task_reopen', {
      reason: REASON,
      findings: FINDINGS,
    });
    expect(answer).toMatchObject({
      ok: true,
      text:
        'Recorded: when your turn ends the task is reopened: it goes back to "Develop" for round 2, in that ' +
        "step's conversation, with your correction. End your turn now.",
    });
    const shown = (await as(w, s.c.viewer)('GET', tasksPath(s.c, '/T-1'))).body as TaskDetailView;
    expect(shown).toMatchObject({
      state: 'done',
      decision: {
        action: 'reopen',
        outcome: 'moved',
        to: { name: 'Develop' },
        reason: REASON,
        by: { name: 'Code Reviewer', kind: 'agent' },
      },
    });
    finish(s.runner, review, 'Reopened it with your correction.');

    // Develop's kept conversation gets round 2, with the correction.
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.sessionId).toBe('b4c1f0e2-session');
    expect(develop.spec.prompt).toMatch(/^Task T-1 is back at your step "Develop" \(Work\): round 2\./);
    expect(develop.spec.prompt).toContain(
      'It was closed at "Code review", and is reopened with a correction: back with you for round 2.',
    );
    expect(develop.spec.prompt).toContain(`Their reason and findings:\n> ${REASON}`);
    const row = await taskRow(w.t.db, closed.task.id);
    expect(row).toMatchObject({
      state: 'active',
      currentStepId: stepOf(s.flow, 'Develop').id,
      stepState: 'working',
      closedAt: null,
      decision: null,
      sprintId: sprint,
    });
    expect((await historyOf(w.t.db, closed.task.id)).slice(-3)).toEqual([
      ['reopened', 'Code review', 'Develop', null],
      ['entered', null, 'Develop', 2],
      ['started', null, 'Develop', null],
    ]);
    const after = (await as(w, s.c.owner)('GET', tasksPath(s.c, '/T-1'))).body as TaskDetailView;
    expect(after.history.find((event) => event.kind === 'reopened')).toMatchObject({
      actor: { principalId: s.c.reviewer, kind: 'agent' },
      reason: REASON,
    });
    expect((await handOffNote(w.t.db, closed.task.id, 'Code review'))?.text).toBe(
      `**Reopened:** ${REASON}\n\n${FINDINGS}`,
    );
    const line = (await roomRows(w.t.db, s.flow.id)).at(-1);
    expect(line).toMatchObject({ authorPrincipalId: s.c.reviewer });
    expect(JSON.stringify(line)).toContain('reopen');
    finish(s.runner, develop, 'Fixed again.');
    await ended(w.t.db, develop.turnId);
    expect(await sprintRows(w.t.db, s.flow.id)).toHaveLength(1);
  });

  it('is refused on an open task', async () => {
    const s = await toolScene(w);
    const open = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const working = await s.runner.frames.next('turn.start');
    expect(
      await toolCall(s.runner, working.turnId, 'task_reopen', { reason: REASON, findings: FINDINGS }),
    ).toMatchObject({
      ok: false,
      text: 'The task is not closed: task_reopen is for a done or cancelled task.',
    });
    finish(s.runner, working, 'Working on it.');
    await ended(w.t.db, working.turnId);
    expect((await taskRow(w.t.db, open.id)).decision).toBeNull();
  });

  it('is dropped when the task is no longer closed as the turn ends', async () => {
    const s = await toolScene(w);
    const closed = await closedAtReview(w, s);
    const review = await said(w, s, closed.review, 'It is wrong.');
    await toolCall(s.runner, review.turnId, 'task_reopen', { reason: REASON, findings: FINDINGS });
    await rawDb(w.t.db)
      .update(tasks)
      .set({
        state: 'active',
        currentStepId: stepOf(s.flow, 'Develop').id,
        stepState: 'waiting',
        closedAt: null,
      })
      .where(eq(tasks.id, closed.task.id));
    finish(s.runner, review, 'Reopened.');
    await eventually(
      'the decision goes',
      async () => (await taskRow(w.t.db, closed.task.id)).decision === null,
    );
    expect(await taskRow(w.t.db, closed.task.id)).toMatchObject({ state: 'active', stepState: 'waiting' });
    expect((await historyOf(w.t.db, closed.task.id)).map(([kind]) => kind)).not.toContain('reopened');
  });

  it('a reopen a person made meanwhile wins: the task is reopened once', async () => {
    const s = await toolScene(w);
    const closed = await closedAtReview(w, s);
    const review = await said(w, s, closed.review, 'It is wrong.');
    await toolCall(s.runner, review.turnId, 'task_reopen', { reason: REASON, findings: FINDINGS });
    const byHand = await moved(w, s.c, s.c.manager, 'T-1', { action: 'reopen', reason: 'By hand' });
    expect(byHand.task).toMatchObject({
      state: 'active',
      step: { name: 'Develop' },
      round: 2,
      decision: null,
    });
    const develop = await s.runner.frames.next('turn.start');
    finish(s.runner, review, 'Reopened.');
    await ended(w.t.db, review.turnId);
    const kinds = (await historyOf(w.t.db, closed.task.id)).map(([kind]) => kind);
    expect(kinds.filter((kind) => kind === 'reopened')).toHaveLength(1);
    expect(await taskRow(w.t.db, closed.task.id)).toMatchObject({ state: 'active', decision: null });
    finish(s.runner, develop, 'Fixed.');
    await ended(w.t.db, develop.turnId);
  });
});
