import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type OpenActivity, openActivity } from '../../../../fixtures/chats/activity.ts';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { agentOf, finish, runScene } from '../../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../../fixtures/tasks.ts';

/**
 * A task's conversation in the company's chats' activity (2026-11-14, T-19; docs/harness.md "Task conversations in the
 * agent's chats"): its step's turn shows as it starts and ends, named by its task, to anyone who reads chats (as its
 * task's page opens it), so the agent's chat list keeps it live apart from its chats.
 */

let w: ChatsWorld;
const open: OpenActivity[] = [];
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  for (const stream of open.splice(0)) await stream.close();
  await w.disconnectAll();
});
afterAll(() => w.close());

describe('a task’s conversation in the chats’ activity', () => {
  it('tells its step’s turn as it starts and ends, named by its task, to a member in none of the agent’s chats', async () => {
    const s = await runScene(w);
    const live = await openActivity(w.t.app, s.c.companyId, s.c.member);
    open.push(live);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const running = await live.next('its turn running', (v) => v.lastTurn?.id === start.turnId);
    const developer = await agentOf(w.t.db, s.c.developer);
    expect(running.chat).toMatchObject({
      agentId: developer.id,
      title: 'T-1 · Develop · Fix the login',
      task: { taskId: task.id, round: 1 },
      forTask: {
        key: 'T-1',
        title: 'Fix the login',
        step: 'Develop',
        rounds: { from: 1, to: 1 },
        atStep: true,
      },
    });
    expect(running.lastTurn).toMatchObject({ status: 'running', system: true });
    finish(s.runner, start);
    await live.next('its end', (v) => v.lastTurn?.id === start.turnId && v.lastTurn.status === 'done');
  });
});
