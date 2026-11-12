import { agents, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { taskTurns } from '../../../../src/modules/chats/service/tasks.ts';
import type { TurnsDeps } from '../../../../src/modules/chats/service/turns.ts';
import {
  BOTH_HARNESSES,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  place,
  sendPrompt,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { enroll } from '../../../fixtures/machines/machines.ts';
import { as } from '../../../fixtures/members/members.ts';
import { agentOf, conversationsOf, finish, runScene, stepStateIs } from '../../../fixtures/runs.ts';
import { makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('taskTurns.start refuses', () => {
  it('a step’s assignee that is no agent, before anything else', async () => {
    const s = await runScene(w);
    const t = await tenant(w.t.db, s.c.companyId);
    const started = await taskTurns({} as TurnsDeps).start(t, {
      by: s.c.owner.principalId,
      requestId: 'r',
      agentPrincipalId: s.c.owner.principalId,
      taskId: s.flow.id,
      stepId: s.flow.id,
      round: 1,
      keep: true,
      title: 'x',
      wakeReason: 'x',
      prompt: { plain: { full: 'x', delta: 'x' }, tools: { full: 'x', delta: 'x' } },
    });
    expect(started).toMatchObject({ ok: false, status: 409, code: 'not_an_agent' });
  });

  it('an archived agent, and one that runs in a container (blocking the task with why)', async () => {
    const s = await runScene(w);
    await rawDb(w.t.db)
      .update(agents)
      .set({ status: 'archived' })
      .where(eq(agents.principalId, s.c.developer));
    const archived = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    expect(archived).toMatchObject({
      stepState: 'blocked',
      blockedReason: expect.stringContaining('archived'),
    });
    const reviewer = await agentOf(w.t.db, s.c.reviewer);
    await place(w, s.c, reviewer.id, { machineId: s.machineId, mode: 'container' });
    const contained = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    expect(contained).toMatchObject({
      stepState: 'blocked',
      blockedReason: expect.stringContaining('container'),
    });
    expect(contained.conversations).toEqual([]);
  });
});

describe('Keep starts a new conversation when the last one cannot go on', () => {
  it('after the agent moved to another machine, or its conversation was archived', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    finish(s.runner, await s.runner.frames.next('turn.start'), 'Round one.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const second = await enroll(w, s.c, { name: 'Devbox' });
    const box = await w.connect(second.runnerKey, { caps: BOTH_HARNESSES });
    const developer = await agentOf(w.t.db, s.c.developer);
    await place(w, s.c, developer.id, { machineId: second.machineId });
    await moved(w, s.c, s.c.manager, task.key, { action: 'start' });
    const moved1 = await box.frames.next('turn.start');
    expect(moved1.spec.sessionId).toBeNull();
    expect(moved1.spec.prompt).toMatch(/^# T-1 · Fix the login/);
    finish(box, moved1, 'Round one, again.', 'box-session');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const [, onBox] = await conversationsOf(w.t.db, task.id);
    expect(onBox).toMatchObject({ machineId: second.machineId, sessionId: 'box-session' });
    expect((await as(w, s.c.owner)('DELETE', chatPath(s.c, onBox?.id as string))).status).toBe(204);
    await moved(w, s.c, s.c.manager, task.key, { action: 'start' });
    const fresh = await box.frames.next('turn.start');
    expect(fresh.spec.sessionId).toBeNull();
    expect(await conversationsOf(w.t.db, task.id)).toHaveLength(3);
  });
});

describe('a step’s own prompt', () => {
  it('is Most Wanted’s turn, still naming the person whose move started it; a person’s reply stays theirs', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    finish(s.runner, start, 'Round one.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const [conversation] = await conversationsOf(w.t.db, task.id);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({
      system: true,
      createdBy: s.c.owner.principalId,
    });
    const reply = await sendPrompt(
      w,
      { company: s.c, chat: conversation as never },
      'Use the staging database',
    );
    expect(reply.status).toBe(202);
    const replied = await s.runner.frames.next('turn.start');
    expect(await turnRow(w.t.db, replied.turnId)).toMatchObject({
      system: false,
      createdBy: s.c.owner.principalId,
    });
  });
});
