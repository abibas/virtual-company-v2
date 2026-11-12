import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatView } from '../../../../src/modules/chats/schemas.ts';
import type { BoardView } from '../../../../src/modules/tasks/schemas/board.ts';
import { agentChatsPath, type ChatsWorld, chatPath, chatsWorld } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import {
  agentOf,
  conversationsOf,
  finish,
  HOME,
  runScene,
  stepStateIs,
  taskRow,
} from '../../../fixtures/runs.ts';
import { flowsPath, historyOf, makeTask, moved, stepOf, tasksPath } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('entering an agent’s step that starts by itself', () => {
  it('starts its turn at once in a new conversation of the task at the step, on the agent’s machine', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
      description: 'The login form accepts an empty password.',
    });
    expect(task).toMatchObject({
      key: 'T-1',
      stepState: 'working',
      blockedReason: null,
      round: 1,
      artifacts: 0,
    });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec).toMatchObject({
      harness: 'claude_code',
      cwd: HOME,
      sessionId: null,
      artifacts: { dir: 'tasks/T-1/artifacts/1-develop/round-1' },
    });
    expect(
      start.spec.prompt.startsWith(
        '# T-1 · Fix the login\n\nYou are working on task T-1 at step 1, "Develop"',
      ),
    ).toBe(true);
    expect(start.spec.prompt).toContain('The login form accepts an empty password.');
    expect(start.spec.prompt).toContain('Flow: DEVBOX delivery · Lead: DEVBOX Coordinator');
    expect(start.spec.prompt).toContain('`tasks/T-1/artifacts/1-develop/round-1/`');
    const [conversation] = task.conversations;
    expect(conversation).toMatchObject({
      step: { name: 'Develop' },
      round: 1,
      agent: { name: 'Developer', kind: 'agent' },
      title: 'T-1 · Develop · Fix the login',
      started: false,
    });
    const chat = await as(w, s.c.owner)('GET', chatPath(s.c, conversation?.chatId as string));
    expect(chat.body).toMatchObject({
      task: { taskId: task.id, stepId: stepOf(s.flow, 'Develop').id, round: 1 },
      turns: [{ id: start.turnId, status: 'running', createdBy: s.c.owner.principalId }],
    });
    // A task's conversation stays out of the agent's own chat list.
    const developer = await agentOf(w.t.db, s.c.developer);
    const list = await as(w, s.c.owner)('GET', agentChatsPath(s.c, developer.id));
    expect((list.body as { chats: ChatView[] }).chats).toEqual([]);
    expect((await historyOf(w.t.db, task.id)).at(-1)).toEqual(['started', null, 'Develop', null]);
  });

  it('blocks the task, saying why, when the agent has no placement or its machine has no runner', async () => {
    const unplaced = await runScene(w, { unplaced: true });
    const task = await makeTask(w, unplaced.c, unplaced.c.owner, {
      flowId: unplaced.flow.id,
      stepId: stepOf(unplaced.flow, 'Develop').id,
    });
    expect(task).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'The agent has no placement: choose where it runs first',
      conversations: [],
    });
    expect((await historyOf(w.t.db, task.id)).at(-1)).toEqual(['blocked', null, 'Develop', 1]);
    const board = await as(w, unplaced.c.viewer)('GET', flowsPath(unplaced.c, `/${unplaced.flow.id}/board`));
    expect((board.body as BoardView).columns[1]?.cards[0]).toMatchObject({
      key: task.key,
      stepState: 'blocked',
      blockedReason: 'The agent has no placement: choose where it runs first',
    });
    const offline = await runScene(w);
    await w.disconnectAll();
    const later = await makeTask(w, offline.c, offline.c.owner, {
      flowId: offline.flow.id,
      stepId: stepOf(offline.flow, 'Develop').id,
    });
    expect(later).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'This Mac is asleep: wake it, and its runner reconnects on its own',
    });
  });
});

describe('entering a step that starts on Start', () => {
  it('waits without a turn, and Start starts it', async () => {
    const s = await runScene(w, { starts: 'manual' });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    expect(task).toMatchObject({ stepState: 'waiting', conversations: [] });
    expect(s.runner.frames.of('turn.start')).toEqual([]);
    const started = await moved(w, s.c, s.c.manager, task.key, { action: 'start' });
    expect(started.task).toMatchObject({
      stepState: 'working',
      conversations: [{ round: 1, started: false }],
    });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.artifacts).toEqual({ dir: 'tasks/T-1/artifacts/1-develop/round-1' });
    expect((await historyOf(w.t.db, task.id)).at(-1)).toEqual(['started', null, 'Develop', null]);
  });
});

describe('a step the task comes back to', () => {
  it('Keep: the same conversation goes on, resumed, with only the hand-off since its last round', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const first = await s.runner.frames.next('turn.start');
    finish(s.runner, first, 'Fixed on branch fix-login.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    const review = await s.runner.frames.next('turn.start');
    expect(review.spec.artifacts).toEqual({ dir: 'tasks/T-1/artifacts/2-code-review/round-1' });
    expect(review.spec.prompt).toContain('"Develop" handed it on to you.');
    expect(review.spec.prompt).toContain('The last reply of "Develop":\n> Fixed on branch fix-login.');
    expect(review.spec.prompt).toContain('- 1-develop/round-1/hand-off note (note, 26 B)');
    finish(s.runner, review, 'SEND BACK\nEmpty passwords still pass.', 'review-session');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, {
      action: 'send_back',
      reason: 'Empty passwords still pass.',
    });
    const again = await s.runner.frames.next('turn.start');
    expect(again.spec.sessionId).toBe('b4c1f0e2-session');
    expect(again.spec.artifacts).toEqual({ dir: 'tasks/T-1/artifacts/1-develop/round-2' });
    expect(again.spec.prompt).toMatch(/^Task T-1 is back at your step "Develop" \(Work\): round 2\./);
    expect(again.spec.prompt).toContain(
      '"Code review" sent it back to you for round 2.\n\nTheir reason and findings:\n> Empty passwords still pass.',
    );
    expect(again.spec.prompt).toContain(
      'New artifacts since your last round:\n- 2-code-review/round-1/hand-off note',
    );
    expect(again.spec.prompt).not.toContain('## The flow');
    const [develop, reviewChat] = await conversationsOf(w.t.db, task.id);
    expect((await conversationsOf(w.t.db, task.id)).length).toBe(2);
    expect(develop).toMatchObject({ taskStepId: stepOf(s.flow, 'Develop').id, taskRound: 1 });
    expect(reviewChat).toMatchObject({
      taskStepId: stepOf(s.flow, 'Code review').id,
      sessionId: 'review-session',
    });
  });

  it('Fresh: a new conversation each round with the whole prompt; the old one stays readable', async () => {
    const s = await runScene(w, { reviewReturns: 'fresh' });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    const first = await s.runner.frames.next('turn.start');
    finish(s.runner, first, 'SEND BACK', 'review-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'send_back', reason: 'Tests fail' });
    const develop = await s.runner.frames.next('turn.start');
    finish(s.runner, develop, 'Fixed.', 'develop-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    const second = await s.runner.frames.next('turn.start');
    expect(second.spec.sessionId).toBeNull();
    expect(second.spec.artifacts).toEqual({ dir: 'tasks/T-1/artifacts/2-code-review/round-2' });
    expect(second.spec.prompt).toMatch(/^# T-1 · Fix the login/);
    expect(second.spec.prompt).toContain('round 2 of its flow.');
    const reviews = (await conversationsOf(w.t.db, task.id)).filter(
      (chat) => chat.taskStepId === stepOf(s.flow, 'Code review').id,
    );
    expect(reviews.map((chat) => chat.taskRound)).toEqual([1, 2]);
    expect(reviews[0]?.sessionId).toBe('review-1');
    const old = await as(w, s.c.owner)('GET', chatPath(s.c, reviews[0]?.id as string));
    expect(old).toMatchObject({
      status: 200,
      body: { turns: [{ status: 'done', resultText: 'SEND BACK' }] },
    });
  });

  it('Keep after a block: Start again continues the round’s conversation with "continue where you left off"', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const first = await s.runner.frames.next('turn.start');
    finish(s.runner, first, 'Half done.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'start' });
    const again = await s.runner.frames.next('turn.start');
    expect(again.spec.prompt).toMatch(
      /^Continue task T-1 at your step "Develop" \(Work\), round 1, where you left off\./,
    );
    expect((await conversationsOf(w.t.db, task.id)).length).toBe(1);
    expect((await taskRow(w.t.db, task.id)).stepState).toBe('working');
  });
});

describe('the task’s detail', () => {
  it('lists its conversations for viewers too, and another company never sees them', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const seen = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${task.key}`));
    expect(seen.body).toMatchObject({
      conversations: [{ step: { name: 'Develop' }, round: 1, lastTurn: { status: 'running' } }],
    });
    const other = await runScene(w);
    const hidden = await as(w, other.c.owner)('GET', tasksPath(other.c, `/${task.id}`));
    expect(hidden.status).toBe(404);
    finish(s.runner, start, 'Fixed.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const ended = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${task.key}`));
    expect(ended.body).toMatchObject({
      conversations: [{ lastTurn: { status: 'done', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } }],
    });
  });
});
