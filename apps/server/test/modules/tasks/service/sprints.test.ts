import { type Sprint, tenant } from '@mwc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tasksRepo } from '../../../../src/modules/tasks/repo.ts';
import { defaultSprintName, reportNow } from '../../../../src/modules/tasks/service/sprints.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { makeFlow, makeTask, stepOf, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('defaultSprintName', () => {
  it('names a new sprint by its number and the day it starts, in UTC', () => {
    expect(defaultSprintName(4, new Date('2026-11-16T08:30:00.000Z'))).toBe('Sprint 4 · Mon 16 Nov');
    expect(defaultSprintName(12, new Date('2026-11-15T23:30:00.000-05:00'))).toBe('Sprint 12 · Mon 16 Nov');
  });
});

describe('reportNow', () => {
  it('says where each open task is: Queued, its step, or a removed step', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    await makeTask(w, c, c.owner, { flowId: flow.id, title: 'Waiting' });
    await makeTask(w, c, c.owner, { flowId: flow.id, title: 'Working', stepId: stepOf(flow, 'QA').id });
    const t = await tenant(w.t.db, c.companyId);
    const sprint = (await tasksRepo.sprints.current(t, flow.id)) as Sprint;
    const steps = await tasksRepo.flows.steps(t, flow.id);
    const where = async (known: typeof steps) =>
      (await reportNow(tasksRepo, t, sprint, known)).carriedOver.map((task) => [task.key, task.where]);
    expect(await where(steps)).toEqual([
      ['T-1', 'Queued'],
      ['T-2', 'QA'],
    ]);
    expect(await where([])).toEqual([
      ['T-1', 'Queued'],
      ['T-2', 'a removed step'],
    ]);
    // An ended sprint carries nothing over any more: its open tasks went on to the next one.
    const ended = { ...sprint, endedAt: new Date() };
    expect((await reportNow(tasksRepo, t, ended, steps)).carriedOver).toEqual([]);
  });
});
