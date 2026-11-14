import { tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AgentChatListView as AgentChatList } from '../../../../src/modules/chats/schemas/activity.ts';
import type { ChatDetailView } from '../../../../src/modules/chats/schemas.ts';
import { taskNamesOf } from '../../../../src/modules/chats/service/task-names.ts';
import {
  agentChatsPath,
  beginChat,
  type ChatsWorld,
  chatPath,
  chatsWorld,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { agentOf, conversationsOf, finish, runScene, stepStateIs } from '../../../fixtures/runs.ts';
import { makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';

/**
 * A task's conversations in the agent's chats (2026-11-14, T-19; docs/harness.md "Task conversations in the agent's
 * chats"): `GET …/agents/{agentId}/chats` holds them apart from the chats (`tasks`), each named by its task (`forTask`:
 * key, title, step, the rounds it covers, where the task stands), for anyone who opens them from the task's page; the
 * open chat names its task too.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('an agent’s task conversations', () => {
  it('are listed apart from its chats, named by their task, for anyone who opens them from the task’s page', async () => {
    const s = await runScene(w);
    const developer = await agentOf(w.t.db, s.c.developer);
    const own = await beginChat(w, s.c, developer.id);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const [conversation] = task.conversations;
    const forTask = {
      taskId: task.id,
      key: 'T-1',
      title: 'Fix the login',
      step: 'Develop',
      rounds: { from: 1, to: 1 },
      state: 'active',
      atStep: true,
    };
    const owners = await as(w, s.c.owner)('GET', agentChatsPath(s.c, developer.id));
    const list = owners.body as AgentChatList;
    expect(list.chats.map((chat) => [chat.id, chat.forTask])).toEqual([[own.id, null]]);
    expect(list.tasks).toEqual([
      expect.objectContaining({
        id: conversation?.chatId,
        title: 'T-1 · Develop · Fix the login',
        task: { taskId: task.id, stepId: stepOf(s.flow, 'Develop').id, round: 1 },
        people: [],
        lastTurn: expect.objectContaining({ id: start.turnId, status: 'running' }),
        forTask,
      }),
    ]);
    // A member in none of its chats sees the same task conversation, and opens it, named by its task.
    const members = await as(w, s.c.member)('GET', agentChatsPath(s.c, developer.id));
    expect(members.body).toEqual({ chats: [], tasks: list.tasks });
    const opened = await as(w, s.c.member)('GET', chatPath(s.c, conversation?.chatId as string));
    expect(opened.status).toBe(200);
    expect((opened.body as ChatDetailView).forTask).toEqual(forTask);
    expect(
      ((await as(w, s.c.owner)('GET', chatPath(s.c, own.id))).body as ChatDetailView).forTask,
    ).toBeNull();
    // A viewer reads no chats, the task's conversations neither; another company's caller gets a 404.
    expect((await as(w, s.c.viewer)('GET', agentChatsPath(s.c, developer.id))).status).toBe(403);
    expect((await as(w, s.c.viewer)('GET', chatPath(s.c, conversation?.chatId as string))).status).toBe(403);
    const elsewhere = await runScene(w);
    expect((await as(w, elsewhere.c.owner)('GET', agentChatsPath(s.c, developer.id))).status).toBe(404);
    finish(s.runner, start);
  });

  it('name the rounds each covers: a Keep step goes on round after round, a Fresh step begins one per round', async () => {
    const s = await runScene(w, { reviewReturns: 'fresh' });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    const review = async (verdict: string, session: string) => {
      finish(s.runner, await s.runner.frames.next('turn.start'), verdict, session);
      await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    };
    await review('SEND BACK', 'review-1');
    await moved(w, s.c, s.c.manager, task.key, { action: 'send_back', reason: 'Tests fail' });
    await review('Fixed.', 'develop-1');
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    await review('SEND BACK', 'review-2');
    await moved(w, s.c, s.c.manager, task.key, { action: 'send_back', reason: 'Still failing' });
    const again = await s.runner.frames.next('turn.start');
    const named = async (principal: string) => {
      const agent = await agentOf(w.t.db, principal);
      const res = await as(w, s.c.owner)('GET', agentChatsPath(s.c, agent.id));
      return (res.body as AgentChatList).tasks.map((chat) => chat.forTask);
    };
    const develop = { key: 'T-1', step: 'Develop', state: 'active' };
    expect(await named(s.c.developer)).toEqual([
      expect.objectContaining({ ...develop, rounds: { from: 1, to: 2 }, atStep: true }),
    ]);
    const reviews = { key: 'T-1', step: 'Code review', atStep: false };
    expect(await named(s.c.reviewer)).toEqual([
      expect.objectContaining({ ...reviews, rounds: { from: 2, to: 2 } }),
      expect.objectContaining({ ...reviews, rounds: { from: 1, to: 1 } }),
    ]);
    finish(s.runner, again);
  });

  it('leave out an archived one; a step removed since keeps a name, and other chats read nothing', async () => {
    const s = await runScene(w);
    const developer = await agentOf(w.t.db, s.c.developer);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    finish(s.runner, await s.runner.frames.next('turn.start'));
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const [chat] = await conversationsOf(w.t.db, task.id);
    const t = await tenant(w.t.db, s.c.companyId);
    const gone = { ...chat, id: chat?.id as string, taskStepId: newId() } as NonNullable<typeof chat>;
    expect((await taskNamesOf(t, [gone])).get(gone.id)).toMatchObject({ key: 'T-1', step: 'a removed step' });
    expect(await taskNamesOf(t, [{ id: 'x', taskId: null, taskStepId: null, taskRound: null }])).toEqual(
      new Map(),
    );
    expect((await as(w, s.c.owner)('DELETE', chatPath(s.c, chat?.id as string))).status).toBe(204);
    const list = await as(w, s.c.owner)('GET', agentChatsPath(s.c, developer.id));
    expect(list.body).toEqual({ chats: [], tasks: [] });
  });
});
