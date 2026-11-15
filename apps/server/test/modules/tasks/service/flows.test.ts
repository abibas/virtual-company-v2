import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { boardOf, errorCode, flowPatched, patchFlow } from '../../../fixtures/tasks/queue.ts';
import {
  devboxSteps,
  type FlowView,
  flowsPath,
  makeFlow,
  stepOf,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('PATCH a flow’s Autotake and new tasks’ defaults (T-25, T-38)', () => {
  it('changes them for the Lead’s people and admins, audited, writing only what differs', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const develop = stepOf(flow, 'Develop').id;
    const change = { autoTake: true, inProgressLimit: 3, newTaskStepId: develop, newTaskAutoTake: true };
    expect(errorCode(await patchFlow(w, c, c.member, flow.id, change))).toBe('not_lead');
    expect(await patchFlow(w, c, c.manager, flow.id, change)).toMatchObject({ status: 200, body: change });
    expect((await patchFlow(w, c, c.admin, flow.id, change)).status).toBe(200);
    expect((await boardOf(w, c, flow.id)).flow).toMatchObject({
      newTaskStepId: develop,
      newTaskAutoTake: true,
    });
    // Queued again: null.
    expect((await flowPatched(w, c, flow.id, { newTaskStepId: null })).newTaskStepId).toBeNull();
    const updates = (await auditTrail(w.t.db, 'flow', flow.id)).filter(([action]) => action === 'update');
    expect(updates.map(([, field]) => field).sort()).toEqual([
      'autoTake',
      'inProgressLimit',
      'newTaskAutoTake',
      'newTaskStepId',
      'newTaskStepId',
    ]);
  });

  it('refuses a new-task step of another flow, a limit outside 1–20 and an unknown flow', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const other = await makeFlow(w, { ...c, lead: c.qaBot }, { name: 'Other' });
    const res = await patchFlow(w, c, c.owner, flow.id, { newTaskStepId: stepOf(other, 'Develop').id });
    expect([res.status, errorCode(res)]).toEqual([422, 'unknown_step']);
    for (const body of [{ inProgressLimit: 0 }, { inProgressLimit: 21 }, { newTaskStepId: 'Develop' }])
      expect((await patchFlow(w, c, c.owner, flow.id, body)).status, JSON.stringify(body)).toBe(400);
    const none = await patchFlow(w, c, c.owner, '019a4f0c-0000-7000-8000-000000000000', { autoTake: true });
    expect([none.status, errorCode(none)]).toEqual([404, 'flow_not_found']);
    const read = (await as(w, c.viewer)('GET', flowsPath(c, `/${flow.id}`))).body as FlowView;
    expect(read).toMatchObject({ autoTake: false, inProgressLimit: 2, newTaskStepId: null });
  });

  it('sends new tasks back to Queued when their step is removed', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    await flowPatched(w, c, flow.id, { newTaskStepId: stepOf(flow, 'QA').id });
    const steps = devboxSteps(c)
      .filter((step) => step.name !== 'QA')
      .map((step) => ({ ...step, id: stepOf(flow, step.name).id }));
    const res = await as(w, c.owner)('PUT', flowsPath(c, `/${flow.id}/steps`), { steps });
    expect(res.status).toBe(200);
    expect((res.body as FlowView).newTaskStepId).toBeNull();
  });
});
