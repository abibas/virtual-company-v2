import { LEAD_TOOLS } from '@mwc/shared/flows';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { beginChat, type ChatsWorld, chatsWorld, sendPrompt } from '../../../fixtures/chats/world.ts';
import { agentOf, runScene } from '../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../fixtures/tasks.ts';
import { leadTurn, toolCall, toolScene } from '../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('the tools a turn gets', () => {
  it('a step’s turn: its kind’s tools, and the prompt that says to use them', async () => {
    const s = await toolScene(w);
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.tools).toEqual(['task_read', 'task_hand_on', 'task_attach', 'task_blocked']);
    expect(develop.spec.prompt).toContain('Then call task_hand_on with your hand-off for "Code review"');
    expect(develop.spec.prompt).toContain(
      'Your move is recorded when you call it and applied when your turn ends',
    );
    expect(develop.spec.prompt).not.toContain('Nobody moves the task for you yet');
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Code review').id });
    const review = await s.runner.frames.next('turn.start');
    expect(review.spec.tools).toEqual([
      'task_read',
      'task_pass',
      'task_send_back',
      'task_attach',
      'task_blocked',
    ]);
    expect(review.spec.prompt).toContain('call task_pass (with your findings, if any) or task_send_back');
  });

  it('a Lead’s own chat: the board tools, and a short section naming them after its instructions', async () => {
    const s = await toolScene(w);
    const { start } = await leadTurn(w, s);
    expect(start.spec.tools).toEqual([...LEAD_TOOLS]);
    expect(start.spec.instructions).toContain(
      '## Leading your team (from Most Wanted)\n\nYou lead the flow "DEVBOX delivery". Your tools act at once, as you: team_board,',
    );
    expect(start.spec.instructions?.startsWith('## Your place in the company')).toBe(true);
  });

  it('an agent that leads nothing gets none in its own chat', async () => {
    const s = await toolScene(w);
    const developer = await agentOf(w.t.db, s.c.developer);
    const chat = await beginChat(w, s.c, developer.id);
    expect((await sendPrompt(w, { company: s.c, chat }, 'Hello')).status).toBe(202);
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.tools).toBeUndefined();
    expect(start.spec.instructions).not.toContain('Leading your team');
    expect((await toolCall(s.runner, start.turnId, 'team_board')).text).toBe(
      "You lead no flow: these tools work in a flow Lead's own chats only.",
    );
  });

  it('a runner without the tools: none, the old prompt, and no section', async () => {
    const s = await runScene(w, { placeLead: true });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.tools).toBeUndefined();
    expect(develop.spec.prompt).toContain('Nobody moves the task for you yet');
    expect(develop.spec.prompt).toContain('End your turn with a short hand-off for "Code review"');
    const { start } = await leadTurn(w, s);
    expect(start.spec.tools).toBeUndefined();
    expect(start.spec.instructions).not.toContain('Leading your team');
  });
});

describe('a call the turn may not make', () => {
  it('is refused: an unknown tool, a Lead’s tool in a step’s turn, a step’s tool in a Lead’s chat', async () => {
    const s = await toolScene(w);
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const develop = await s.runner.frames.next('turn.start');
    expect(await toolCall(s.runner, develop.turnId, 'task_fly')).toMatchObject({
      ok: false,
      text: 'Unknown tool: task_fly',
    });
    expect((await toolCall(s.runner, develop.turnId, 'team_board')).text).toBe(
      "team_board works only in your own chats as a flow's Lead, not in a task's step.",
    );
    const { start } = await leadTurn(w, s);
    expect((await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: 'x' })).text).toBe(
      "task_hand_on works only in a task step's turn.",
    );
    expect((await toolCall(s.runner, start.turnId, 'task_show', { key: 'twelve' })).text).toContain(
      'key: a task key such as T-12',
    );
  });
});
