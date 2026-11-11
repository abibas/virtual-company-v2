import { tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { seedAgent, TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatPath, chatsWorld } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { finish, stepStateIs, taskRow } from '../../../fixtures/runs.ts';
import { act, flowsPath, historyOf, makeTask, stepOf, tasksPath } from '../../../fixtures/tasks.ts';
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

describe('the Lead’s board tools', () => {
  it('team_board and task_show read its flow', async () => {
    const s = await toolScene(w);
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, title: 'Fix the docs', priority: 'high' });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    await s.runner.frames.next('turn.start');
    const { start } = await leadTurn(w, s);
    const board = await toolCall(s.runner, start.turnId, 'team_board');
    expect(board.ok).toBe(true);
    expect(board.text).toContain('Flow "DEVBOX delivery" · Lead: DEVBOX Coordinator');
    expect(board.text).toContain('Queued (1)\n- T-1 · Fix the docs · high');
    expect(board.text).toContain('Develop · Work · Developer (1)\n- T-2 · Fix the login · working');
    expect(board.text).toContain('Done (0 of 0)');
    const shown = await toolCall(s.runner, start.turnId, 'task_show', { key: 't-2' });
    expect(shown.text).toMatch(
      /^# T-2 · Fix the login\n\nState: active at "Develop" \(working\), round 1 · priority normal/,
    );
    expect(shown.text).toContain('## History (latest 4 of 4)');
  });

  it('task_create makes a task queued or into a step, as the Lead, and a step that starts by itself runs', async () => {
    const s = await toolScene(w);
    const { start } = await leadTurn(w, s);
    expect(await toolCall(s.runner, start.turnId, 'task_create', { title: 'Fix the docs' })).toMatchObject({
      ok: true,
      text: 'Created T-1 "Fix the docs": queued.',
    });
    const into = await toolCall(s.runner, start.turnId, 'task_create', {
      title: 'Fix the login',
      description: 'Empty passwords pass.',
      priority: 'urgent',
      step: 'develop',
    });
    expect(into.text).toBe('Created T-2 "Fix the login": active at "Develop" (working), round 1.');
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.prompt).toContain('Empty passwords pass.');
    const row = await taskRow(w.t.db, await idOf(s.c.companyId, 2));
    expect(row).toMatchObject({ createdBy: s.c.lead, priority: 'urgent' });
    expect((await historyOf(w.t.db, row.id)).slice(0, 2)).toEqual([
      ['created', null, null, null],
      ['routed', null, 'Develop', null],
    ]);
    const detail = await as(w, s.c.owner)('GET', tasksPath(s.c, '/T-2'));
    const body = detail.body as { history: { actor: unknown }[]; conversations: { chatId: string }[] };
    expect(body.history[0]?.actor).toMatchObject({ kind: 'agent', name: 'DEVBOX Coordinator' });
    const chat = await as(w, s.c.owner)('GET', chatPath(s.c, body.conversations[0]?.chatId as string));
    expect(chat.body).toMatchObject({ turns: [{ createdBy: s.c.lead }] });
    expect((await toolCall(s.runner, start.turnId, 'task_create', { title: 'x', step: 'Deploy' })).text).toBe(
      'No step "Deploy" in your flow; its steps: "Develop", "Code review", "Approve".',
    );
  });

  it('route, start, retry and cancel act at once, never over a running turn', async () => {
    const s = await toolScene(w);
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id });
    const { start } = await leadTurn(w, s);
    const lead = (tool: string, input: Record<string, unknown>) =>
      toolCall(s.runner, start.turnId, tool, input);
    expect((await lead('task_route', { key: 'T-1', step: 'Code review' })).text).toBe(
      'Done: T-1 is now active at "Code review" (working), round 1.',
    );
    const review = await s.runner.frames.next('turn.start');
    expect((await lead('task_cancel', { key: 'T-1', reason: 'Not needed' })).text).toBe(
      "The step's turn is running: stop it first, or move the task with force, which stops it",
    );
    const id = await idOf(s.c.companyId, 1);
    finish(s.runner, review, 'SEND BACK');
    await stepStateIs(w.t.db, id, 'ended_without_handoff');
    expect((await lead('task_start', { key: 'T-1' })).text).toBe(
      'Done: T-1 is now active at "Code review" (working), round 1.',
    );
    const again = await s.runner.frames.next('turn.start');
    finish(s.runner, again, 'SEND BACK');
    await stepStateIs(w.t.db, id, 'ended_without_handoff');
    const reviewId = stepOf(s.flow, 'Code review').id;
    await rawDb(w.t.db)
      .update(tasks)
      .set({ rounds: { [reviewId]: { entries: 1, sendBacks: 3 } } })
      .where(eq(tasks.id, id));
    expect(
      (await act(w, s.c, s.c.owner, 'T-1', { action: 'send_back', reason: 'Again' })).body,
    ).toMatchObject({
      outcome: 'escalated',
    });
    expect((await lead('task_retry', { key: 'T-1' })).text).toBe(
      'Done: T-1 is now active at "Develop" (working), round 1.',
    );
    const develop = await s.runner.frames.next('turn.start');
    finish(s.runner, develop, 'Done.');
    await stepStateIs(w.t.db, id, 'ended_without_handoff');
    expect((await lead('task_cancel', { key: 'T-1', reason: 'Not needed after all' })).text).toBe(
      'Done: T-1 is cancelled.',
    );
    expect((await historyOf(w.t.db, id)).at(-1)).toEqual(['cancelled', 'Develop', null, null]);
    expect((await lead('task_start', { key: 'T-1' })).ok).toBe(false);
  });

  it('only in its own flow: another flow’s task is as none, and nothing of it moves', async () => {
    const s = await toolScene(w);
    const other = await seedAgent(w.t.db, s.c.companyId, {
      name: 'QA Lead',
      slug: 'qa-lead',
      roleTitle: 'QA Lead',
      reportsTo: s.c.manager.principalId,
    });
    const flow = await as(w, s.c.owner)('POST', flowsPath(s.c), {
      leadPrincipalId: other.principal.id,
      name: 'QA',
      steps: [{ name: 'Test', kind: 'work', assigneePrincipalId: s.c.qaBot }],
    });
    expect(flow.status).toBe(201);
    await makeTask(w, s.c, s.c.owner, { flowId: (flow.body as { id: string }).id, title: 'Test the login' });
    const { start } = await leadTurn(w, s);
    for (const [tool, input] of [
      ['task_show', { key: 'T-1' }],
      ['task_cancel', { key: 'T-1', reason: 'Mine now' }],
      ['task_route', { key: 'T-1', step: 'Develop' }],
    ] as const) {
      expect(await toolCall(s.runner, start.turnId, tool, input)).toMatchObject({
        ok: false,
        text: 'No task T-1 in your flow "DEVBOX delivery".',
      });
    }
    expect((await taskRow(w.t.db, await idOf(s.c.companyId, 1))).state).toBe('queued');
  });
});

/** The id of the company's task with this number. */
async function idOf(companyId: string, number: number): Promise<string> {
  const where = and(eq(tasks.companyId, companyId), eq(tasks.number, number));
  return (await rawDb(w.t.db).select().from(tasks).where(where))[0]?.id as string;
}
