import { flows, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tasksRepo } from '../../../../src/modules/tasks/repo.ts';
import { endsProgress, takeQueued } from '../../../../src/modules/tasks/service/auto-take.ts';
import { auditRows } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { autoTakeOn, edited, flowPatched, keysIn, queuedKeys, shown } from '../../../fixtures/tasks/queue.ts';
import { makeFlow, makeTask, moved, stepOf, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** A team and its flow: Develop (the Developer, by hand), QA (the tester, sending back to Develop once), Approve. */
async function team() {
  const c = await teamCompany(w);
  const steps = [
    { name: 'Develop', kind: 'work', assigneePrincipalId: c.developer },
    {
      name: 'QA',
      kind: 'check',
      assigneePrincipalId: c.tester.principalId,
      sendsBackTo: 'Develop',
      sendBackLimit: 1,
    },
    { name: 'Approve', kind: 'signoff', assigneePrincipalId: c.owner.principalId, sendsBackTo: 'Develop' },
  ];
  const flow = await makeFlow(w, c, { steps });
  const task = (body: Record<string, unknown> = {}) => makeTask(w, c, c.owner, { flowId: flow.id, ...body });
  const active = () => keysIn(w, c, flow.id, 'active');
  const queued = () => queuedKeys(w, c, flow.id);
  return { c, flow, task, active, queued };
}

describe('Autotake from Queued (T-25, T-34)', () => {
  it('is off by default: the flow takes nothing and new tasks are Manual', async () => {
    const s = await team();
    expect(s.flow).toMatchObject({
      autoTake: false,
      inProgressLimit: 2,
      newTaskStepId: null,
      newTaskAutoTake: false,
    });
    expect(await s.task()).toMatchObject({ state: 'queued', autoTake: false, queue: { place: 1, of: 1 } });
    expect(await s.task({ autoTake: true })).toMatchObject({ state: 'queued', autoTake: true });
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'cancel' });
    expect([await s.active(), await s.queued()]).toEqual([[], ['T-2']]);
  });

  it('takes only queued Autotake tasks into the first step, the most urgent and then the first placed, up to its limit', async () => {
    const s = await team();
    await s.task({ title: 'Manual and urgent', priority: 'urgent' }); // T-1
    await s.task({ title: 'Low', priority: 'low', autoTake: true }); // T-2
    await s.task({ title: 'Normal', autoTake: true }); // T-3
    await s.task({ title: 'Urgent', priority: 'urgent', autoTake: true }); // T-4
    await s.task({ title: 'Normal too', autoTake: true }); // T-5
    expect(await autoTakeOn(w, s.c, s.flow.id)).toMatchObject({ autoTake: true, inProgressLimit: 2 });
    expect([await s.active(), await s.queued()]).toEqual([
      ['T-4', 'T-3'],
      ['T-1', 'T-5', 'T-2'],
    ]);
    expect(await shown(w, s.c, 'T-4')).toMatchObject({
      state: 'active',
      step: { name: 'Develop' },
      stepState: 'waiting',
      round: 1,
      queue: null,
    });
    // A task put into a step by hand counts as in progress: the flow is over its limit until two leave.
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'route', toStepId: stepOf(s.flow, 'QA').id });
    await moved(w, s.c, s.c.owner, 'T-4', { action: 'cancel' });
    expect([await s.active(), await s.queued()]).toEqual([
      ['T-3', 'T-1'],
      ['T-5', 'T-2'],
    ]);
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'cancel' });
    expect([await s.active(), await s.queued()]).toEqual([['T-5', 'T-3'], ['T-2']]);
  });

  it('writes the take as a route by nobody, marked autoTake, audited as the system’s', async () => {
    const s = await team();
    await autoTakeOn(w, s.c, s.flow.id);
    const task = await s.task({ autoTake: true });
    expect(
      task.history.map((e) => [e.kind, e.actor?.principalId ?? null, e.to?.name ?? null, e.details]),
    ).toEqual([
      ['created', s.c.owner.principalId, null, {}],
      ['routed', null, 'Develop', { autoTake: true }],
      ['entered', null, 'Develop', {}],
    ]);
    const routes = (await auditRows(w.t.db, 'task', task.id)).filter((row) => row.action === 'route');
    expect(routes.length).toBeGreaterThan(0);
    for (const row of routes)
      expect(row).toMatchObject({ actorKind: 'system', actorPrincipalId: null, requestId: null });
  });

  it('takes again after a task is done, cancelled or escalated, never counting the escalated', async () => {
    const s = await team();
    await autoTakeOn(w, s.c, s.flow.id, 1);
    await s.task({ stepId: stepOf(s.flow, 'Approve').id }); // T-1
    for (const n of [2, 3, 4]) await s.task({ title: `Queued ${n}`, autoTake: true });
    expect([await s.active(), await s.queued()]).toEqual([['T-1'], ['T-2', 'T-3', 'T-4']]);
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'approve' });
    expect(await s.active()).toEqual(['T-2']);
    await moved(w, s.c, s.c.owner, 'T-2', { action: 'cancel', reason: 'Not needed' });
    expect(await s.active()).toEqual(['T-3']);
    // A move that keeps it in progress takes nothing.
    await moved(w, s.c, s.c.owner, 'T-3', { action: 'hand_on' });
    await moved(w, s.c, s.c.tester, 'T-3', { action: 'send_back', reason: 'The tests fail' });
    await moved(w, s.c, s.c.owner, 'T-3', { action: 'hand_on' });
    expect(await s.queued()).toEqual(['T-4']);
    const escalated = await moved(w, s.c, s.c.tester, 'T-3', {
      action: 'send_back',
      reason: 'Still failing',
    });
    expect(escalated.outcome).toBe('escalated');
    expect([await s.active(), await keysIn(w, s.c, s.flow.id, 'escalated')]).toEqual([['T-4'], ['T-3']]);
  });

  it('skips a task waiting for an open task, and takes it once that task is closed', async () => {
    const s = await team();
    await autoTakeOn(w, s.c, s.flow.id, 2);
    await s.task({ title: 'Schema' }); // T-1, Manual
    const waiting = await s.task({ title: 'API', priority: 'urgent', autoTake: true, waitsFor: ['T-1'] });
    expect(waiting).toMatchObject({ state: 'queued', waitsFor: [{ key: 'T-1', state: 'queued' }] });
    expect((await s.task({ title: 'Web', autoTake: true })).state).toBe('active'); // T-3
    // In progress is still open: it waits on.
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'route', toStepId: stepOf(s.flow, 'QA').id });
    await moved(w, s.c, s.c.owner, 'T-3', { action: 'cancel' });
    expect(await s.queued()).toEqual(['T-2']);
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'cancel' });
    expect(await shown(w, s.c, 'T-2')).toMatchObject({
      state: 'active',
      step: { name: 'Develop' },
      waitsFor: [{ key: 'T-1', state: 'cancelled' }],
    });
  });

  it('takes when a task is made in Queued with room, and leaves a Manual one', async () => {
    const s = await team();
    await autoTakeOn(w, s.c, s.flow.id, 1);
    expect(await s.task()).toMatchObject({ key: 'T-1', state: 'queued', autoTake: false });
    expect(await s.task({ autoTake: true })).toMatchObject({ key: 'T-2', state: 'active', queue: null });
    expect(await s.task({ autoTake: true })).toMatchObject({ key: 'T-3', state: 'queued' });
  });

  it('takes when the flow PATCH turns it on or changes its limit, never on a rename or while it is off', async () => {
    const s = await team();
    for (const n of [1, 2, 3]) await s.task({ title: `Queued ${n}`, autoTake: true });
    await flowPatched(w, s.c, s.flow.id, { name: 'Renamed' });
    await flowPatched(w, s.c, s.flow.id, { inProgressLimit: 1 });
    expect(await s.active()).toEqual([]);
    await flowPatched(w, s.c, s.flow.id, { autoTake: true });
    expect(await s.active()).toEqual(['T-1']);
    // Room made behind its back waits for a change that takes: a rename does not.
    await rawDb(w.t.db).update(flows).set({ inProgressLimit: 3 }).where(eq(flows.id, s.flow.id));
    await flowPatched(w, s.c, s.flow.id, { name: 'Renamed again' });
    expect(await s.active()).toEqual(['T-1']);
    await flowPatched(w, s.c, s.flow.id, { inProgressLimit: 2 });
    expect(await s.active()).toEqual(['T-2', 'T-1']);
    await flowPatched(w, s.c, s.flow.id, { autoTake: false });
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'cancel' });
    expect(await s.queued()).toEqual(['T-3']);
  });

  it('takes a queued task edited to Autotake or no longer waiting, while the flow has room', async () => {
    const s = await team();
    await autoTakeOn(w, s.c, s.flow.id, 1);
    await s.task({ title: 'Schema' }); // T-1, Manual
    await s.task({ title: 'API', autoTake: true, waitsFor: ['T-1'] }); // T-2, waits
    expect(await s.active()).toEqual([]);
    expect(await edited(w, s.c, s.c.owner, 'T-2', { waitsFor: [] })).toMatchObject({
      state: 'active',
      waitsFor: [],
    });
    await s.task({ title: 'Web' }); // T-3, Manual
    expect(await edited(w, s.c, s.c.owner, 'T-3', { autoTake: true })).toMatchObject({ state: 'queued' });
    await moved(w, s.c, s.c.owner, 'T-2', { action: 'cancel' });
    expect(await s.active()).toEqual(['T-3']);
    expect(await edited(w, s.c, s.c.owner, 'T-1', { autoTake: true })).toMatchObject({ state: 'queued' });
  });
});

describe('takeQueued', () => {
  it('says how many it took: none for no flow, a flow that does not auto-take, or no room', async () => {
    const s = await team();
    const t = await tenant(w.t.db, s.c.companyId);
    const take = (flowId = s.flow.id) => takeQueued({ db: w.t.db }, tasksRepo, t, flowId, new Date(TEST_NOW));
    for (const n of [1, 2, 3]) await s.task({ title: `Queued ${n}`, autoTake: true });
    expect(await take('019a4f0c-0000-7000-8000-000000000000')).toBe(0);
    expect(await take()).toBe(0);
    await rawDb(w.t.db).update(flows).set({ autoTake: true }).where(eq(flows.id, s.flow.id));
    expect(await take()).toBe(2);
    expect(await take()).toBe(0);
    expect([await s.active(), await s.queued()]).toEqual([['T-2', 'T-1'], ['T-3']]);
  });

  it('ends a task’s time in progress on done, cancelled and escalated only', () => {
    const outcomes = ['started', 'moved', 'done', 'escalated', 'cancelled'] as const;
    expect(outcomes.filter((outcome) => endsProgress({ outcome }))).toEqual([
      'done',
      'escalated',
      'cancelled',
    ]);
  });
});
