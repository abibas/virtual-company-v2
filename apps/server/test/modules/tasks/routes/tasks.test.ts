import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  type FlowView,
  historyOf,
  makeFlow,
  makeTask,
  moved,
  stepOf,
  type TaskDetailView,
  type TeamCompany,
  taskNotices,
  tasksPath,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const errorCode = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;
type Page = { tasks: { key: string; state: string }[]; nextBefore: number | null };

describe('POST /api/companies/:companyId/tasks', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('makes a queued task for any member, numbered in the company, with its history and audit', async () => {
    const task = await makeTask(w, c, c.member, {
      flowId: flow.id,
      description: '# Steps',
      priority: 'high',
    });
    expect(task).toMatchObject({
      key: 'T-1',
      number: 1,
      title: 'Fix the login',
      description: '# Steps',
      priority: 'high',
      state: 'queued',
      flow: { id: flow.id, name: 'DEVBOX delivery', lead: { name: 'DEVBOX Coordinator' } },
      createdBy: { principalId: c.member.principalId },
      rounds: [],
      escalation: null,
      actions: [],
    });
    expect((await makeTask(w, c, c.tester, { flowId: flow.id })).key).toBe('T-2');
    expect(await historyOf(w.t.db, task.id)).toEqual([['created', null, null, null]]);
    expect(await auditTrail(w.t.db, 'task', task.id)).toEqual(
      expect.arrayContaining([['create', 'title', null, 'Fix the login']]),
    );
    // Another company counts its own.
    const other = await teamCompany(w);
    expect((await makeTask(w, other, other.owner, { flowId: (await makeFlow(w, other)).id })).key).toBe(
      'T-1',
    );
  });

  it('puts a task straight into a step for the Lead’s people and admins, telling a person of their step', async () => {
    const qa = stepOf(flow, 'QA').id;
    const refused = await as(w, c.member)('POST', tasksPath(c), { flowId: flow.id, title: 'x', stepId: qa });
    expect([refused.status, errorCode(refused)]).toEqual([403, 'not_lead']);
    const task = await makeTask(w, c, c.manager, { flowId: flow.id, stepId: qa });
    expect(task).toMatchObject({ state: 'active', step: { name: 'QA' }, round: 1, stepState: 'waiting' });
    expect(await taskNotices(w.t.db, c.companyId)).toEqual([[c.tester.principalId, 'task_at_step']]);
    const other = await makeFlow(w, { ...c, lead: c.qaBot }, { name: 'Other' });
    const elsewhere = { flowId: flow.id, title: 'x', stepId: stepOf(other, 'QA').id };
    expect(errorCode(await as(w, c.owner)('POST', tasksPath(c), elsewhere))).toBe('unknown_step');
  });

  it('refuses viewers, a malformed body, and a flow of another company', async () => {
    expect(errorCode(await as(w, c.viewer)('POST', tasksPath(c), { flowId: flow.id, title: 'x' }))).toBe(
      'forbidden',
    );
    expect((await as(w, c.owner)('POST', tasksPath(c), { flowId: flow.id, title: '  ' })).status).toBe(400);
    const other = await membersCompany(w);
    const res = await as(w, other.owner)('POST', tasksPath(other), { flowId: flow.id, title: 'x' });
    expect([res.status, errorCode(res)]).toEqual([404, 'flow_not_found']);
  });
});

describe('GET /api/companies/:companyId/tasks', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
    await makeTask(w, c, c.owner, { flowId: flow.id }); // T-1 queued
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'QA').id }); // T-2 at QA
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'Code review').id }); // T-3
    for (const reason of ['a', 'b', 'c', 'd']) {
      await moved(w, c, c.owner, 'T-3', { action: 'send_back', reason });
      if (reason !== 'd') await moved(w, c, c.owner, 'T-3', { action: 'hand_on' });
    }
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id }); // T-4
    await moved(w, c, c.owner, 'T-4', { action: 'cancel' });
  });
  const list = async (query = '') => {
    const res = await as(w, c.viewer)('GET', tasksPath(c, query));
    expect(res.status).toBe(200);
    return res.body as Page;
  };
  const keys = (page: Page) => page.tasks.map((task) => task.key);

  it('lists every task newest first, and by flow, state, step or assignee', async () => {
    expect(keys(await list())).toEqual(['T-4', 'T-3', 'T-2', 'T-1']);
    expect(keys(await list(`?flowId=${flow.id}&state=queued`))).toEqual(['T-1']);
    expect(keys(await list('?state=escalated'))).toEqual(['T-3']);
    expect(keys(await list('?state=cancelled'))).toEqual(['T-4']);
    expect(keys(await list(`?stepId=${stepOf(flow, 'QA').id}`))).toEqual(['T-2']);
    expect(keys(await list(`?assignee=${c.tester.principalId}`))).toEqual(['T-2']);
    expect(keys(await list(`?assignee=${c.lead}`))).toEqual(['T-3']);
    expect(keys(await list(`?assignee=${c.member.principalId}`))).toEqual([]);
    const escalated = (await list('?state=escalated')).tasks[0];
    expect(escalated).toMatchObject({
      assignee: { name: 'DEVBOX Coordinator' },
      step: { name: 'Code review' },
    });
  });

  it('pages with limit and before', async () => {
    const first = await list('?limit=3');
    expect([keys(first), first.nextBefore]).toEqual([['T-4', 'T-3', 'T-2'], 2]);
    const second = await list('?limit=3&before=2');
    expect([keys(second), second.nextBefore]).toEqual([['T-1'], null]);
    expect((await as(w, c.viewer)('GET', tasksPath(c, '?limit=0'))).status).toBe(400);
  });

  it('reads a task by key in any case or by id; 404 for none, a malformed one or another company’s', async () => {
    const byKey = (await as(w, c.viewer)('GET', tasksPath(c, '/t-2'))).body as TaskDetailView;
    expect(byKey).toMatchObject({ key: 'T-2', step: { name: 'QA' } });
    expect((await as(w, c.viewer)('GET', tasksPath(c, `/${byKey.id}`))).body).toMatchObject({ key: 'T-2' });
    for (const ref of ['T-99', 'T-0', 'x-2', '019a4f0c-0000-7000-8000-000000000000']) {
      expect(errorCode(await as(w, c.viewer)('GET', tasksPath(c, `/${ref}`)))).toBe('task_not_found');
    }
    const other = await membersCompany(w);
    expect(errorCode(await as(w, other.owner)('GET', tasksPath(other, `/${byKey.id}`)))).toBe(
      'task_not_found',
    );
    expect(errorCode(await as(w, other.owner)('GET', tasksPath(c, '/T-2')))).toBe('not_found');
  });
});

describe('PATCH /api/companies/:companyId/tasks/:taskId', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('edits for its creator, the Lead’s people and admins, writing only what changed', async () => {
    const task = await makeTask(w, c, c.member, { flowId: flow.id });
    const edit = (by: typeof c.owner, body: unknown) =>
      as(w, by)('PATCH', tasksPath(c, `/${task.key}`), body);
    expect(await edit(c.member, { title: 'Fix the sign-in', priority: 'urgent' })).toMatchObject({
      status: 200,
      body: { title: 'Fix the sign-in', priority: 'urgent' },
    });
    expect(errorCode(await edit(c.tester, { title: 'Mine' }))).toBe('not_yours');
    expect(errorCode(await edit(c.viewer, { title: 'Mine' }))).toBe('forbidden');
    expect((await edit(c.manager, { description: 'More' })).status).toBe(200);
    expect((await edit(c.admin, { description: 'More', priority: 'urgent' })).status).toBe(200);
    expect((await edit(c.owner, {})).status).toBe(200);
    const history = ((await as(w, c.viewer)('GET', tasksPath(c, `/${task.key}`))).body as TaskDetailView)
      .history;
    expect(history.filter((e) => e.kind === 'edited').map((e) => e.details)).toEqual([
      { fields: ['title', 'priority'] },
      { fields: ['description'] },
    ]);
    expect((await auditTrail(w.t.db, 'task', task.id)).filter(([action]) => action === 'update')).toEqual([
      ['update', 'priority', 'normal', 'urgent'],
      ['update', 'title', 'Fix the login', 'Fix the sign-in'],
      ['update', 'description', '', 'More'],
    ]);
    expect(errorCode(await as(w, c.owner)('PATCH', tasksPath(c, '/T-77'), { title: 'x' }))).toBe(
      'task_not_found',
    );
  });
});

describe('GET /api/companies/:companyId/tasks: several states, a search, the latest activity first', () => {
  let c: TeamCompany;
  type Cursored = Page & { nextCursor: string | null };
  const list = async (query: string) => {
    const res = await as(w, c.viewer)('GET', tasksPath(c, query));
    expect(res.status).toBe(200);
    return res.body as Cursored;
  };
  const keys = async (query: string) => (await list(query)).tasks.map((task) => task.key);
  beforeAll(async () => {
    c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    await makeTask(w, c, c.owner, { flowId: flow.id }); // T-1 queued: Fix the login
    await makeTask(w, c, c.owner, {
      flowId: flow.id,
      title: 'Speed up 50% of builds',
      stepId: stepOf(flow, 'QA').id,
    }); // T-2
    await makeTask(w, c, c.owner, { flowId: flow.id, title: 'Login page copy' }); // T-3
    await moved(w, c, c.owner, 'T-3', { action: 'cancel' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const edited = await as(w, c.owner)('PATCH', tasksPath(c, '/T-1'), { priority: 'high' });
    expect(edited.status).toBe(200);
  });

  it('takes several states at once and refuses an unknown one', async () => {
    expect(await keys('?state=queued,active,escalated')).toEqual(['T-2', 'T-1']);
    expect(await keys('?state=cancelled,done')).toEqual(['T-3']);
    expect(await keys('?state=active')).toEqual(['T-2']);
    expect((await as(w, c.viewer)('GET', tasksPath(c, '?state=open'))).status).toBe(400);
  });

  it('searches the key, the number and the title in any case, wildcards taken literally', async () => {
    expect(await keys('?q=LOGIN')).toEqual(['T-3', 'T-1']);
    expect(await keys('?q=t-2')).toEqual(['T-2']);
    expect(await keys('?q=3')).toEqual(['T-3']);
    expect(await keys(`?q=${encodeURIComponent('50%')}`)).toEqual(['T-2']);
    expect(await keys('?q=_')).toEqual([]);
    expect(await keys('?q=%20')).toEqual(['T-3', 'T-2', 'T-1']);
    expect(await keys('?q=login&state=queued')).toEqual(['T-1']);
  });

  it('sorts by the latest change and pages with a cursor in either order', async () => {
    expect(await keys('?sort=updated')).toEqual(['T-1', 'T-3', 'T-2']);
    const first = await list('?sort=updated&limit=2');
    expect([first.tasks.map((task) => task.key), first.nextBefore]).toEqual([['T-1', 'T-3'], 3]);
    const second = await list(`?sort=updated&limit=2&cursor=${first.nextCursor}`);
    expect([second.tasks.map((task) => task.key), second.nextCursor]).toEqual([['T-2'], null]);
    const newest = await list('?limit=2');
    expect(await keys(`?cursor=${newest.nextCursor}`)).toEqual(['T-1']);
    expect((await as(w, c.viewer)('GET', tasksPath(c, '?cursor=12'))).status).toBe(400);
  });
});
