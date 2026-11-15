import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { edited, errorCode, patchTask, shown } from '../../../fixtures/tasks/queue.ts';
import { makeFlow, makeTask, moved, stepOf, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('editing a task’s Autotake (PATCH autoTake, T-34)', () => {
  it('changes while the task is queued, for its creator and those who lead, and is ignored once it left Queued', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const task = await makeTask(w, c, c.member, { flowId: flow.id });
    expect(task.autoTake).toBe(false);
    expect(errorCode(await patchTask(w, c, c.tester, 'T-1', { autoTake: true }))).toBe('not_yours');
    expect(await edited(w, c, c.member, 'T-1', { autoTake: true })).toMatchObject({
      state: 'queued',
      autoTake: true,
    });
    expect((await edited(w, c, c.manager, 'T-1', { autoTake: false })).autoTake).toBe(false);
    await edited(w, c, c.admin, 'T-1', { autoTake: true });
    await moved(w, c, c.owner, 'T-1', { action: 'route', toStepId: stepOf(flow, 'Develop').id });
    // Out of Queued: Autotake is left as it was, and the rest of the edit is made.
    expect(await edited(w, c, c.owner, 'T-1', { autoTake: false, title: 'Fix the sign-in' })).toMatchObject({
      state: 'active',
      autoTake: true,
      title: 'Fix the sign-in',
    });
    await edited(w, c, c.owner, 'T-1', { autoTake: false });
    const edits = (await shown(w, c, 'T-1')).history.filter((e) => e.kind === 'edited');
    expect(edits.map((e) => e.details)).toEqual([
      { fields: ['autoTake'] },
      { fields: ['autoTake'] },
      { fields: ['autoTake'] },
      { fields: ['title'] },
    ]);
    const updates = (await auditTrail(w.t.db, 'task', task.id)).filter(([action]) => action === 'update');
    expect(updates.map(([, field]) => field)).toEqual(['autoTake', 'autoTake', 'autoTake', 'title']);
  });

  it('answers 404 for a task of none, and refuses a viewer', async () => {
    const c = await teamCompany(w);
    await makeTask(w, c, c.member, { flowId: (await makeFlow(w, c)).id });
    expect(errorCode(await patchTask(w, c, c.owner, 'T-9', { autoTake: true }))).toBe('task_not_found');
    expect(errorCode(await patchTask(w, c, c.viewer, 'T-1', { autoTake: true }))).toBe('forbidden');
  });
});
