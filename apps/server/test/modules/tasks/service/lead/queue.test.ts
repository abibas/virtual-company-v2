import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { finish } from '../../../../fixtures/runs.ts';
import { autoTakeOn, flowPatched, shown } from '../../../../fixtures/tasks/queue.ts';
import { makeTask, stepOf } from '../../../../fixtures/tasks.ts';
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

describe('the Lead’s queue tools (T-34, T-38, T-39)', () => {
  it('task_create takes the flow’s defaults for what it leaves out, and Queued, Autotake, waits and a place when said', async () => {
    const s = await toolScene(w);
    await flowPatched(w, s.c, s.flow.id, {
      newTaskStepId: stepOf(s.flow, 'Develop').id,
      newTaskAutoTake: true,
    });
    const { start } = await leadTurn(w, s);
    expect(start.spec.instructions).toContain('(now: new tasks go to "Develop")');
    const lead = (input: Record<string, unknown>) => toolCall(s.runner, start.turnId, 'task_create', input);
    expect((await lead({ title: 'Fix the login' })).text).toBe(
      'Created T-1 "Fix the login": active at "Develop" (working), round 1.',
    );
    finish(s.runner, await s.runner.frames.next('turn.start'), 'Looked at it.');
    expect((await lead({ title: 'Schema', step: 'Queued' })).text).toBe(
      'Created T-2 "Schema": queued (Queue: 1 of 1 · Autotake).',
    );
    const api = { title: 'API', step: 'queued', autoTake: false, priority: 'high', waitsFor: ['T-2'] };
    expect((await lead(api)).text).toBe(
      'Created T-3 "API": queued (Queue: 1 of 2 · Manual · waits for T-2 (queued)).',
    );
    expect((await lead({ title: 'Web', step: 'Queued', after: 'T-3' })).text).toBe(
      'Created T-4 "Web": queued (Queue: 2 of 3 · Autotake).',
    );
    expect(await shown(w, s.c, 'T-4')).toMatchObject({
      priority: 'high',
      createdBy: { principalId: s.c.lead },
    });
    expect(await lead({ title: 'x', step: 'Queued', waitsFor: ['T-9'] })).toMatchObject({
      ok: false,
      text: 'No task T-9 in the flow "DEVBOX delivery"',
    });
  });

  it('task_queue places a queued task and sets its waits, Autotake and priority at once, refusing in words', async () => {
    const s = await toolScene(w);
    for (const title of ['Schema', 'API', 'Web'])
      await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, title });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id }); // T-4
    await s.runner.frames.next('turn.start');
    const { start } = await leadTurn(w, s);
    const lead = (input: Record<string, unknown>) => toolCall(s.runner, start.turnId, 'task_queue', input);
    expect((await lead({ key: 'T-3', before: 'T-1', autoTake: true, waitsFor: ['T-2'] })).text).toBe(
      'Done: T-3 is queued · Queue: 1 of 3 · Autotake · waits for T-2 (queued) · priority normal.',
    );
    expect((await lead({ key: 't-1', after: 'T-3', priority: 'urgent' })).text).toBe(
      'Done: T-1 is queued · Queue: 1 of 3 · Manual · priority urgent.',
    );
    const edit = (await shown(w, s.c, 'T-3')).history.at(-1);
    expect(edit).toMatchObject({ kind: 'edited', actor: { kind: 'agent', name: 'DEVBOX Coordinator' } });
    expect(await lead({ key: 'T-4', after: 'T-1' })).toEqual(
      expect.objectContaining({
        ok: false,
        text: 'T-4 is active, not queued: task_queue changes only queued tasks.',
      }),
    );
    expect((await lead({ key: 'T-2', before: 'T-1', after: 'T-3' })).text).toBe(
      'Give before or after, not both.',
    );
    expect(await lead({ key: 'T-2', waitsFor: ['T-3'] })).toMatchObject({
      ok: false,
      text: 'T-3 already waits (through the tasks it waits for) for this task: that would be a cycle',
    });
    // Autotake on, with room: the task is taken at once and its step starts.
    await autoTakeOn(w, s.c, s.flow.id, 2);
    expect((await lead({ key: 'T-2', autoTake: true })).text).toBe(
      'Done: T-2 is active at "Develop" (working), round 1 · priority normal.',
    );
    expect((await s.runner.frames.next('turn.start')).spec.prompt).toContain('T-2');
  });
});
