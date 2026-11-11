import { auditLog, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatPath, chatsWorld } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import {
  artifactsOf,
  endTurn,
  eventually,
  finish,
  type RunScene,
  sendEvents,
  stepStateIs,
  taskRow,
} from '../../../fixtures/runs.ts';
import { historyOf, makeTask, moved, stepOf, tasksPath } from '../../../fixtures/tasks.ts';
import { toolCall, toolScene } from '../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A task made into `step`, and its turn as the runner got it. */
async function atStep(s: RunScene, step = 'Develop') {
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, step).id });
  return { task, start: await s.runner.frames.next('turn.start') };
}

const noteOf = async (taskId: string, stepName: string) =>
  (await artifactsOf(w.t.db, taskId)).find(
    (row) => row.stepName === stepName && row.name === 'hand-off note',
  );

describe('a move called during a step’s turn', () => {
  it('is recorded, shown on the task, and applied when the turn ends, by the agent, its summary the hand-off note', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    const answer = await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: 'Fixed on fix/login.' });
    expect(answer).toMatchObject({
      ok: true,
      text: 'Recorded: when your turn ends the task goes to "Code review". End your turn now.',
    });
    const shown = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${task.key}`));
    expect(shown.body).toMatchObject({
      stepState: 'working',
      decision: {
        action: 'hand_on',
        outcome: 'moved',
        to: { name: 'Code review' },
        reason: null,
        by: { name: 'Developer', kind: 'agent' },
      },
    });
    const decided = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, task.id), eq(auditLog.action, 'decide')));
    expect(decided).toMatchObject([
      { actorKind: 'agent', actorPrincipalId: s.c.developer, field: 'decision' },
    ]);
    finish(s.runner, start, 'All done, see the summary.');
    const review = await s.runner.frames.next('turn.start');
    expect(review.spec.prompt).toContain('The last reply of "Develop":\n> Fixed on fix/login.');
    const row = await taskRow(w.t.db, task.id);
    expect(row).toMatchObject({ stepState: 'working', decision: null });
    expect((await historyOf(w.t.db, task.id)).slice(-3)).toEqual([
      ['handed_on', 'Develop', 'Code review', null],
      ['entered', null, 'Code review', 1],
      ['started', null, 'Code review', null],
    ]);
    const after = await as(w, s.c.owner)('GET', tasksPath(s.c, `/${task.key}`));
    const handedOn = (after.body as { history: { kind: string; actor: unknown }[] }).history.find(
      (event) => event.kind === 'handed_on',
    );
    expect(handedOn?.actor).toMatchObject({ principalId: s.c.developer, kind: 'agent', slug: 'developer' });
    expect((after.body as { decision: unknown }).decision).toBeNull();
    expect((await noteOf(task.id, 'Develop'))?.bytes).toEqual(
      new TextEncoder().encode('Fixed on fix/login.'),
    );
    const reviewChat = await as(w, s.c.owner)(
      'GET',
      chatPath(
        s.c,
        (after.body as { conversations: { chatId: string }[] }).conversations[1]?.chatId as string,
      ),
    );
    expect(reviewChat.body).toMatchObject({ turns: [{ createdBy: s.c.developer }] });
  });

  it('a second call replaces the first, and the last one counts', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s, 'Code review');
    await toolCall(s.runner, start.turnId, 'task_pass', { findings: 'Looks right.' });
    const again = await toolCall(s.runner, start.turnId, 'task_send_back', {
      reason: 'Empty passwords pass',
      findings: 'login.ts line 12 accepts "".',
    });
    expect(again.text).toBe(
      'This replaces your earlier decision (pass). Recorded: when your turn ends the task goes back to "Develop" ' +
        'for round 1. End your turn now.',
    );
    finish(s.runner, start, 'SEND BACK');
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.prompt).toContain('Their reason and findings:\n> Empty passwords pass');
    expect(develop.spec.prompt).toContain('**Sent back:** Empty passwords pass');
    expect((await historyOf(w.t.db, task.id)).at(-3)).toEqual(['sent_back', 'Code review', 'Develop', null]);
  });

  it('over the step’s limit says the task will be escalated, and escalates it', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s, 'Code review');
    const review = stepOf(s.flow, 'Code review').id;
    await rawDb(w.t.db)
      .update(tasks)
      .set({ rounds: { [review]: { entries: 4, sendBacks: 3 } } })
      .where(eq(tasks.id, task.id));
    const answer = await toolCall(s.runner, start.turnId, 'task_send_back', {
      reason: 'Still broken',
      findings: 'Same bug.',
    });
    expect(answer.text).toBe(
      'Recorded: "Code review" has sent this task back 3 times already, its limit, so when your turn ends it is ' +
        'escalated to the team\'s Lead (DEVBOX Coordinator) instead of going back to "Develop". End your turn now.',
    );
    finish(s.runner, start, 'SEND BACK');
    await eventually(
      'the task is escalated',
      async () => (await taskRow(w.t.db, task.id)).state === 'escalated',
    );
    const row = await taskRow(w.t.db, task.id);
    expect(row).toMatchObject({
      state: 'escalated',
      decision: null,
      escalationTargetStepId: stepOf(s.flow, 'Develop').id,
    });
    expect((await historyOf(w.t.db, task.id)).at(-1)).toEqual(['escalated', 'Code review', 'Develop', null]);
  });

  it('task_blocked blocks the task with its reason when the turn ends, by the agent', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    const answer = await toolCall(s.runner, start.turnId, 'task_blocked', {
      reason: 'No access to the repo',
    });
    expect(answer.text).toBe(
      'Recorded: when your turn ends the task is marked blocked: No access to the repo. End your turn now.',
    );
    finish(s.runner, start, 'I cannot reach the repository.');
    const row = await stepStateIs(w.t.db, task.id, 'blocked');
    expect(row).toMatchObject({ blockedReason: 'No access to the repo', decision: null });
    const after = await as(w, s.c.owner)('GET', tasksPath(s.c, `/${task.key}`));
    expect(
      (after.body as { history: { kind: string; actor: unknown; reason: string }[] }).history.at(-1),
    ).toMatchObject({
      kind: 'blocked',
      actor: { kind: 'agent', name: 'Developer' },
      reason: 'No access to the repo',
    });
    expect((await noteOf(task.id, 'Develop'))?.bytes).toEqual(
      new TextEncoder().encode('I cannot reach the repository.'),
    );
  });

  it('a failed turn drops the decision and blocks the task as before; a stopped one leaves it for a person', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: 'Done.' });
    sendEvents(s.runner, start.turnId, [{ type: 'result', ok: false, error: 'API error' }]);
    endTurn(s.runner, start.turnId, { ok: false, exitCode: 1 });
    const row = await stepStateIs(w.t.db, task.id, 'blocked');
    expect(row).toMatchObject({ currentStepId: stepOf(s.flow, 'Develop').id, decision: null });
    await moved(w, s.c, s.c.manager, task.key, { action: 'start' });
    const again = await s.runner.frames.next('turn.start');
    await toolCall(s.runner, again.turnId, 'task_hand_on', { summary: 'Done now.' });
    endTurn(s.runner, again.turnId, { ok: false, exitCode: null, error: 'stopped' });
    const stopped = await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    expect(stopped).toMatchObject({ currentStepId: stepOf(s.flow, 'Develop').id, decision: null });
  });
});

describe('a move the turn may not make', () => {
  it('is refused in words: a bad input, a move of another kind, a task that moved on', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    expect(await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: '  ' })).toMatchObject({
      ok: false,
      text: expect.stringContaining('task_hand_on did nothing; fix its input and call it again:\nsummary:'),
    });
    expect(await toolCall(s.runner, start.turnId, 'task_pass', {})).toMatchObject({
      ok: false,
      text: 'task_pass is not a move of "Develop", a work step: use task_hand_on.',
    });
    expect(
      await toolCall(s.runner, start.turnId, 'task_send_back', { reason: 'x', findings: 'y' }),
    ).toMatchObject({
      ok: false,
      text: expect.stringContaining('task_send_back is not a move of "Develop"'),
    });
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on', force: true });
    expect(await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: 'Late.' })).toMatchObject({
      ok: false,
      text: 'The task is no longer at your step: nothing was recorded.',
    });
    expect((await taskRow(w.t.db, task.id)).decision).toBeNull();
  });
});
