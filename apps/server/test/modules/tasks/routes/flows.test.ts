import { seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  devboxSteps,
  type FlowView,
  flowsPath,
  leadFlowPath,
  makeFlow,
  makeTask,
  moved,
  stepOf,
  type TeamCompany,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const errorCode = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;

describe('POST /api/companies/:companyId/flows', () => {
  let c: TeamCompany;
  beforeAll(async () => {
    c = await teamCompany(w);
  });

  it("makes a team's flow with its steps in order, their defaults and targets by name, audited", async () => {
    const flow = await makeFlow(w, c, { by: c.manager });
    expect(flow).toMatchObject({
      name: 'DEVBOX delivery',
      lead: { principalId: c.lead, kind: 'agent', name: 'DEVBOX Coordinator', slug: 'devbox-coordinator' },
    });
    expect(
      flow.steps.map((s) => [s.position, s.name, s.kind, s.assignee.name, s.starts, s.onReturn]),
    ).toEqual([
      [1, 'Develop', 'work', 'Developer', 'manual', 'keep'],
      [2, 'Code review', 'check', 'Code Reviewer', 'manual', 'keep'],
      [3, 'QA', 'check', c.tester.subject, 'manual', 'fresh'],
      [4, 'Approve', 'signoff', `Owner ${c.owner.subject}`, 'manual', 'keep'],
    ]);
    const develop = stepOf(flow, 'Develop');
    expect(stepOf(flow, 'Code review')).toMatchObject({
      sendsBackToStepId: develop.id,
      sendsBackTo: 'Develop',
      sendBackLimit: 3,
      openTasks: 0,
    });
    expect(stepOf(flow, 'Approve')).toMatchObject({ sendsBackTo: 'Develop', sendBackLimit: null });
    expect(await auditTrail(w.t.db, 'flow', flow.id)).toEqual(
      expect.arrayContaining([['create', 'name', null, 'DEVBOX delivery']]),
    );
    expect(await auditTrail(w.t.db, 'flow_step', develop.id)).toEqual(
      expect.arrayContaining([['create', 'name', null, 'Develop']]),
    );
    expect(errorCode(await as(w, c.owner)('POST', flowsPath(c), { ...body(c), name: 'Again' }))).toBe(
      'flow_exists',
    );
  });

  it('is for the Lead’s people and admins only; viewers not at all', async () => {
    const lead = (await seedAgent(w.t.db, c.companyId, { reportsTo: c.manager.principalId })).principal.id;
    const make = (by: typeof c.owner) =>
      as(w, by)('POST', flowsPath(c), { ...body(c), leadPrincipalId: lead });
    expect(errorCode(await make(c.member))).toBe('not_lead');
    expect(errorCode(await make(c.tester))).toBe('not_lead');
    expect(errorCode(await make(c.viewer))).toBe('forbidden');
    expect((await make(c.admin)).status).toBe(201);
  });

  it('refuses a Lead off the chart or of another company', async () => {
    const archived = await seedAgent(w.t.db, c.companyId, { status: 'archived', reportsTo: c.lead });
    const other = await membersCompany(w);
    for (const leadPrincipalId of [archived.principal.id, other.owner.principalId]) {
      const res = await as(w, c.owner)('POST', flowsPath(c), { ...body(c), leadPrincipalId });
      expect(res).toMatchObject({ status: 422, body: { error: { code: 'lead_not_found' } } });
    }
  });

  it('refuses a step list the rules refuse, with their codes', async () => {
    const lead = (await seedAgent(w.t.db, c.companyId, { reportsTo: c.owner.principalId })).principal.id;
    const archived = await seedAgent(w.t.db, c.companyId, { status: 'archived', reportsTo: lead });
    const [develop, review] = devboxSteps(c) as unknown as [Record<string, unknown>, Record<string, unknown>];
    const cases: [unknown[], string][] = [
      [[], 'no_steps'],
      [Array.from({ length: 21 }, (_, i) => ({ ...develop, name: `S${i}` })), 'too_many_steps'],
      [[develop, { ...develop, name: ' develop ' }], 'duplicate_step_name'],
      [[{ ...develop, assigneePrincipalId: archived.principal.id }], 'assignee_not_found'],
      [[{ ...develop, sendBackLimit: 2 }], 'work_sends_back'],
      [[review, develop], 'bad_send_back'],
      [[develop, { ...review, sendsBackTo: null }], 'bad_send_back'],
      [[{ ...develop, id: '019a4f0c-0000-7000-8000-000000000000' }], 'unknown_step'],
    ];
    for (const [steps, expected] of cases) {
      const res = await as(w, c.owner)('POST', flowsPath(c), { leadPrincipalId: lead, name: 'X', steps });
      expect([res.status, errorCode(res)]).toEqual([422, expected]);
    }
    const bad = await as(w, c.owner)('POST', flowsPath(c), {
      leadPrincipalId: lead,
      name: 'X',
      steps: [{ ...develop, kind: 'review' }],
    });
    expect(bad.status).toBe(400);
  });
});

/** A new flow's body for the team's Lead. */
const body = (c: TeamCompany) => ({
  leadPrincipalId: c.lead,
  name: 'DEVBOX delivery',
  steps: devboxSteps(c),
});

describe('GET flows: the list, one by id or by its Lead', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
    await makeTask(w, c, c.member, { flowId: flow.id });
  });

  it('lists the flows with their Lead, steps and open tasks, for everyone of the company', async () => {
    const res = await as(w, c.viewer)('GET', flowsPath(c));
    expect(res.status).toBe(200);
    expect((res.body as { flows: unknown[] }).flows).toEqual([
      expect.objectContaining({ id: flow.id, name: 'DEVBOX delivery', stepCount: 4, openTasks: 1 }),
    ]);
  });

  it('reads a flow by id, by its Lead’s id or slug; another company’s is a 404', async () => {
    for (const path of [flowsPath(c, `/${flow.id}`), leadFlowPath(c, c.lead), leadFlowPath(c, c.leadSlug)]) {
      const res = await as(w, c.viewer)('GET', path);
      expect([res.status, (res.body as FlowView).id]).toEqual([200, flow.id]);
    }
    const other = await membersCompany(w);
    for (const path of [
      flowsPath(other, `/${flow.id}`),
      leadFlowPath(other, c.lead),
      leadFlowPath(other, 'nobody'),
      flowsPath(other, '/not-an-id'),
    ]) {
      expect(await as(w, other.owner)('GET', path)).toMatchObject({
        status: 404,
        body: { error: { code: 'flow_not_found' } },
      });
    }
    expect((await as(w, other.owner)('GET', flowsPath(c, `/${flow.id}`))).status).toBe(404);
  });
});

describe('PATCH flows/:flowId and PUT flows/:flowId/steps', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('renames a flow for the Lead’s people and admins, writing nothing when the name is the same', async () => {
    const rename = (by: typeof c.owner, name: string) =>
      as(w, by)('PATCH', flowsPath(c, `/${flow.id}`), { name });
    expect(errorCode(await rename(c.member, 'Mine'))).toBe('not_lead');
    expect(await rename(c.manager, 'DEVBOX')).toMatchObject({ status: 200, body: { name: 'DEVBOX' } });
    expect((await rename(c.admin, 'DEVBOX')).status).toBe(200);
    expect((await auditTrail(w.t.db, 'flow', flow.id)).filter(([action]) => action === 'update')).toEqual([
      ['update', 'name', 'DEVBOX delivery', 'DEVBOX'],
    ]);
    expect(
      (await as(w, c.owner)('PUT', flowsPath(c, '/not-an-id/steps'), { steps: devboxSteps(c) })).status,
    ).toBe(404);
    expect(
      (await as(w, c.owner)('PATCH', flowsPath(c, '/019a4f0c-0000-7000-8000-000000000000'), { name: 'x' }))
        .status,
    ).toBe(404);
  });

  it('reorders, renames, adds and removes steps, keeping each step’s id and the tasks at it', async () => {
    const task = await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'QA').id });
    const ids = Object.fromEntries(flow.steps.map((s) => [s.name, s.id]));
    const steps = [
      { id: ids.Develop, name: 'Build', kind: 'work', assigneePrincipalId: c.developer },
      {
        id: ids.QA,
        name: 'QA',
        kind: 'check',
        assigneePrincipalId: c.qaBot,
        sendsBackTo: 'Build',
        sendBackLimit: 1,
      },
      {
        id: ids['Code review'],
        name: 'Review',
        kind: 'check',
        assigneePrincipalId: c.reviewer,
        sendsBackTo: 'QA',
      },
      { name: 'Ship', kind: 'work', assigneePrincipalId: c.developer, starts: 'auto' },
    ];
    const put = (by: typeof c.owner, list: unknown[]) =>
      as(w, by)('PUT', flowsPath(c, `/${flow.id}/steps`), { steps: list });
    expect(errorCode(await put(c.member, steps))).toBe('not_lead');
    const res = await put(c.manager, steps);
    expect(res.status).toBe(200);
    const after = res.body as FlowView;
    expect(
      after.steps.map((s) => [s.id === ids[s.name] || s.name, s.name, s.sendsBackTo, s.openTasks]),
    ).toEqual([
      ['Build', 'Build', null, 0],
      [true, 'QA', 'Build', 1],
      ['Review', 'Review', 'QA', 0],
      ['Ship', 'Ship', null, 0],
    ]);
    expect(stepOf(after, 'Build').id).toBe(ids.Develop);
    expect(stepOf(after, 'Review').id).toBe(ids['Code review']);
    expect(await auditTrail(w.t.db, 'flow_step', ids.Approve as string)).toEqual(
      expect.arrayContaining([['delete', 'name', 'Approve', null]]),
    );
    const read = await as(w, c.viewer)('GET', `/api/companies/${c.companyId}/tasks/${task.key}`);
    expect(read.body).toMatchObject({ step: { id: ids.QA, name: 'QA' }, round: 1 });
  });

  it('refuses removing a step a task is at or bound for, until it is routed away', async () => {
    const develop = stepOf(flow, 'Develop');
    const flowNow = (await as(w, c.owner)('GET', flowsPath(c, `/${flow.id}`))).body as FlowView;
    const keep = flowNow.steps.filter((s) => s.name !== 'QA');
    const list = keep.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      assigneePrincipalId: s.assignee.principalId,
      sendsBackTo: s.sendsBackTo === 'QA' ? null : s.sendsBackTo,
      sendBackLimit: s.sendsBackTo === 'QA' ? null : s.sendBackLimit,
    }));
    const put = () => as(w, c.owner)('PUT', flowsPath(c, `/${flow.id}/steps`), { steps: list });
    const refused = await put();
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'step_has_tasks' } } });
    expect(errorCode(refused)).toBe('step_has_tasks');
    expect((refused.body as { error: { message: string } }).error.message).toContain('T-1');
    await moved(w, c, c.owner, 'T-1', { action: 'route', toStepId: develop.id });
    expect((await put()).status).toBe(200);
  });
});
