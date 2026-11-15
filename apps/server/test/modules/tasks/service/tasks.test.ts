import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { errorCode, flowPatched, queuedKeys } from '../../../fixtures/tasks/queue.ts';
import {
  historyOf,
  makeFlow,
  makeTask,
  stepOf,
  taskNotices,
  tasksPath,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('a new task’s defaults (T-38)', () => {
  it('without a step or Autotake takes the flow’s: Queued and Manual, or what its Lead chose, for anyone', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const make = (body: Record<string, unknown> = {}) =>
      makeTask(w, c, c.member, { flowId: flow.id, ...body });
    expect(await make()).toMatchObject({ state: 'queued', autoTake: false, queue: { place: 1, of: 1 } });
    await flowPatched(w, c, flow.id, { newTaskStepId: stepOf(flow, 'QA').id, newTaskAutoTake: true });
    expect(await make()).toMatchObject({
      key: 'T-2',
      state: 'active',
      step: { name: 'QA' },
      stepState: 'waiting',
      autoTake: true,
      queue: null,
    });
    expect(await taskNotices(w.t.db, c.companyId)).toEqual([[c.tester.principalId, 'task_at_step']]);
    // Said otherwise: Queued (null) for anyone, Manual; a step still only for those who lead.
    expect(await make({ stepId: null })).toMatchObject({ state: 'queued', autoTake: true });
    expect(await make({ stepId: null, autoTake: false })).toMatchObject({ state: 'queued', autoTake: false });
    const into = { flowId: flow.id, title: 'x', stepId: stepOf(flow, 'Develop').id };
    expect(errorCode(await as(w, c.member)('POST', tasksPath(c), into))).toBe('not_lead');
    expect(await makeTask(w, c, c.manager, { ...into, autoTake: false })).toMatchObject({
      step: { name: 'Develop' },
      autoTake: false,
    });
  });

  it('a default step that starts by itself starts the task at once', async () => {
    const c = await teamCompany(w);
    const steps = [
      { name: 'Develop', kind: 'work', assigneePrincipalId: c.developer, starts: 'auto' },
      { name: 'Approve', kind: 'signoff', assigneePrincipalId: c.owner.principalId, sendsBackTo: 'Develop' },
    ];
    const flow = await makeFlow(w, c, { steps });
    await flowPatched(w, c, flow.id, { newTaskStepId: stepOf(flow, 'Develop').id });
    const task = await makeTask(w, c, c.member, { flowId: flow.id });
    // Its run started, and was refused at once: the Developer sits on no machine here.
    expect(task).toMatchObject({ state: 'active', step: { name: 'Develop' }, stepState: 'blocked' });
    expect((await historyOf(w.t.db, task.id)).map(([kind]) => kind)).toEqual([
      'created',
      'routed',
      'entered',
      'started',
      'blocked',
    ]);
  });
});

describe('a new task’s place and waits (T-39)', () => {
  it('goes right after a queued task, taking its priority unless one is given, and waits for tasks of its flow', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const make = (body: Record<string, unknown> = {}) =>
      makeTask(w, c, c.member, { flowId: flow.id, ...body });
    await make({ priority: 'high' }); // T-1
    await make({ priority: 'high' }); // T-2
    await make(); // T-3
    expect(await make({ after: 't-1', waitsFor: ['T-3', 'T-2'] })).toMatchObject({
      key: 'T-4',
      priority: 'high',
      queue: { place: 2, of: 4 },
      waitsFor: [
        { key: 'T-2', state: 'queued' },
        { key: 'T-3', state: 'queued' },
      ],
    });
    expect(await queuedKeys(w, c, flow.id)).toEqual(['T-1', 'T-4', 'T-2', 'T-3']);
    expect(await make({ after: 'T-1', priority: 'low' })).toMatchObject({ queue: { place: 5, of: 5 } });
    // Into a step, it has no place in Queued.
    const into = { stepId: stepOf(flow, 'Develop').id, after: 'T-1' };
    expect(await makeTask(w, c, c.owner, { flowId: flow.id, ...into })).toMatchObject({
      key: 'T-6',
      state: 'active',
      queue: null,
    });
  });

  it('refuses a wait or a place outside the flow’s queue, and makes nothing', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id }); // T-1
    const post = (body: Record<string, unknown>) =>
      as(w, c.member)('POST', tasksPath(c), { flowId: flow.id, title: 'x', ...body });
    for (const [body, code] of [
      [{ waitsFor: ['T-9'] }, 'unknown_task'],
      [{ after: 'T-9' }, 'unknown_task'],
      [{ after: 'T-1' }, 'target_not_queued'],
    ] as const) {
      const res = await post(body);
      expect([res.status, errorCode(res)], JSON.stringify(body)).toEqual([422, code]);
    }
    expect((await makeTask(w, c, c.member, { flowId: flow.id })).key).toBe('T-2');
  });
});
