import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { textsOf } from '../../../fixtures/notifications.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  act,
  type FlowView,
  historyOf,
  makeFlow,
  makeTask,
  moved,
  stepOf,
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

describe('POST /api/companies/:companyId/tasks/:taskId/actions: a task through the DEVBOX flow', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('goes from the queue to done, sent back, escalated and retried on the way, telling the people', async () => {
    const created = await makeTask(w, c, c.member, { flowId: flow.id });
    expect(created).toMatchObject({ key: 'T-1', state: 'queued', step: null, round: null, assignee: null });
    const key = created.key;
    const develop = stepOf(flow, 'Develop');
    const routed = await moved(w, c, c.manager, key, { action: 'route', toStepId: develop.id });
    expect(routed.task).toMatchObject({ state: 'active', stepState: 'waiting', round: 1 });
    expect(routed.task.assignee).toMatchObject({ name: 'Developer', kind: 'agent' });
    // Start runs the agent's step (S5.3b): the Developer has no placement here, so it is blocked, saying why.
    expect((await moved(w, c, c.manager, key, { action: 'start' })).task).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'The agent has no placement: choose where it runs first',
    });
    expect((await moved(w, c, c.manager, key, { action: 'hand_on' })).task.step?.name).toBe('Code review');
    // Code review sends it back three times; the fourth goes to the Lead instead.
    for (const round of [1, 2, 3]) {
      const back = await moved(w, c, c.admin, key, {
        action: 'send_back',
        reason: `Round ${round}: tests fail`,
      });
      expect(back).toMatchObject({ outcome: 'moved', task: { step: { name: 'Develop' }, round: round + 1 } });
      await moved(w, c, c.manager, key, { action: 'hand_on' });
    }
    const escalated = await moved(w, c, c.admin, key, { action: 'send_back', reason: 'Still failing' });
    expect(escalated.outcome).toBe('escalated');
    expect(escalated.task).toMatchObject({
      state: 'escalated',
      stepState: null,
      step: { name: 'Code review' },
      assignee: { principalId: c.lead },
      escalation: {
        reason: 'Code review sent it back 3 times already, its limit; this time: Still failing',
        retryTo: { name: 'Develop' },
      },
    });
    expect(escalated.task.rounds).toEqual([
      { step: expect.objectContaining({ name: 'Develop' }), entries: 4, sendBacks: 0 },
      { step: expect.objectContaining({ name: 'Code review' }), entries: 4, sendBacks: 3 },
    ]);
    expect((await act(w, c, c.manager, key, { action: 'hand_on' })).body).toMatchObject({
      error: { code: 'wrong_state' },
    });
    const retried = await moved(w, c, c.manager, key, { action: 'retry' });
    expect(retried.task).toMatchObject({
      state: 'active',
      step: { name: 'Develop' },
      round: 5,
      escalation: null,
    });
    await moved(w, c, c.manager, key, { action: 'hand_on' });
    const atQa = await moved(w, c, c.manager, key, { action: 'pass' });
    expect(atQa.task).toMatchObject({ step: { name: 'QA' }, stepState: 'waiting' });
    expect(atQa.task.assignee?.principalId).toBe(c.tester.principalId);
    // The tester, a person, moves the task at their own step; the sign-off then waits for the owner.
    const atApprove = await moved(w, c, c.tester, key, { action: 'pass' });
    expect(atApprove.task).toMatchObject({ step: { name: 'Approve' }, stepState: 'needs_person' });
    expect((await act(w, c, c.tester, key, { action: 'approve' })).body).toMatchObject({
      error: { code: 'not_your_step' },
    });
    const done = await moved(w, c, c.owner, key, { action: 'approve' });
    expect(done).toMatchObject({ outcome: 'done', task: { state: 'done', step: null, assignee: null } });
    expect(done.task.closedAt).not.toBeNull();
    expect(done.task.actions).toEqual([]);

    const history = await historyOf(w.t.db, created.id);
    expect(history.slice(0, 9)).toEqual([
      ['created', null, null, null],
      ['routed', null, 'Develop', null],
      ['entered', null, 'Develop', 1],
      ['started', null, 'Develop', null],
      ['blocked', null, 'Develop', 1],
      ['handed_on', 'Develop', 'Code review', null],
      ['entered', null, 'Code review', 1],
      ['sent_back', 'Code review', 'Develop', null],
      ['entered', null, 'Develop', 2],
    ]);
    expect(history.slice(-11)).toEqual([
      ['escalated', 'Code review', 'Develop', null],
      ['retried', 'Code review', 'Develop', null],
      ['entered', null, 'Develop', 5],
      ['handed_on', 'Develop', 'Code review', null],
      ['entered', null, 'Code review', 5],
      ['passed', 'Code review', 'QA', null],
      ['entered', null, 'QA', 1],
      ['passed', 'QA', 'Approve', null],
      ['entered', null, 'Approve', 1],
      ['signed_off', 'Approve', null, null],
      ['done', 'Approve', null, null],
    ]);

    expect(await taskNotices(w.t.db, c.companyId)).toEqual([
      [c.manager.principalId, 'task_blocked'],
      [c.manager.principalId, 'task_escalated'],
      [c.tester.principalId, 'task_at_step'],
      [c.owner.principalId, 'task_signoff'],
      [c.member.principalId, 'task_done'],
      [c.manager.principalId, 'task_done'],
    ]);
    expect(await textsOf(w, c, c.owner)).toEqual(['T-1 “Fix the login” needs your sign-off at Approve']);
    expect(await textsOf(w, c, c.manager)).toEqual([
      'T-1 “Fix the login” is done',
      'T-1 “Fix the login” was escalated to DEVBOX Coordinator from Code review',
      "T-1 “Fix the login” is blocked at Develop: Developer's turn could not start or failed",
    ]);
  });

  it('shows the history with who did each move, and the moves the caller may make', async () => {
    const task = await makeTask(w, c, c.manager, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id });
    const back = await as(w, c.manager)('GET', tasksPath(c, `/${task.key.toLowerCase()}`));
    expect(back.status).toBe(200);
    const detail = back.body as typeof task;
    expect(detail.history.map((event) => [event.kind, event.actor?.name ?? null])).toEqual([
      ['created', c.manager.subject],
      ['routed', c.manager.subject],
      ['entered', c.manager.subject],
    ]);
    expect(detail.actions).toEqual(['start', 'hand_on', 'route', 'cancel']);
    const asMember = (await as(w, c.member)('GET', tasksPath(c, `/${task.id}`))).body as typeof task;
    expect(asMember.actions).toEqual([]);
    const asViewer = (await as(w, c.viewer)('GET', tasksPath(c, `/${task.key}`))).body as typeof task;
    expect(asViewer.actions).toEqual([]);
  });
});

describe('POST …/actions: refusals', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });
  const atDevelop = () => makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id });
  const code = async (by: typeof c.owner, key: string, body: Record<string, unknown>) =>
    ((await act(w, c, by, key, body)).body as { error: { code: string } }).error.code;

  it('refuses each move the task as it stands has not', async () => {
    const queued = await makeTask(w, c, c.member, { flowId: flow.id });
    expect(await code(c.owner, queued.key, { action: 'start' })).toBe('wrong_state');
    expect(await code(c.owner, queued.key, { action: 'hand_on' })).toBe('wrong_state');
    expect(await code(c.owner, queued.key, { action: 'retry' })).toBe('wrong_state');
    const task = await atDevelop();
    expect(await code(c.owner, task.key, { action: 'pass' })).toBe('wrong_kind');
    expect(await code(c.owner, task.key, { action: 'approve' })).toBe('wrong_kind');
    expect(await code(c.owner, task.key, { action: 'send_back', reason: 'x' })).toBe('wrong_kind');
    // A blocked step starts again (S5.3b: the agent has no placement here, so it stays blocked).
    expect((await moved(w, c, c.owner, task.key, { action: 'start' })).task.stepState).toBe('blocked');
    expect((await moved(w, c, c.owner, task.key, { action: 'start' })).task.stepState).toBe('blocked');
    expect(await code(c.owner, task.key, { action: 'route' })).toBe('step_required');
    expect(await code(c.owner, task.key, { action: 'route', toStepId: stepOf(flow, 'Develop').id })).toBe(
      'already_at_step',
    );
    const other = await makeFlow(w, { ...c, lead: c.reviewer }, { name: 'Other' });
    expect(await code(c.owner, task.key, { action: 'route', toStepId: other.steps[0]?.id })).toBe(
      'unknown_step',
    );
    await moved(w, c, c.owner, task.key, { action: 'hand_on' });
    expect(await code(c.owner, task.key, { action: 'send_back' })).toBe('reason_required');
    expect(await code(c.owner, task.key, { action: 'send_back', reason: '   ' })).toBe('reason_required');
    expect(await code(c.owner, task.key, { action: 'hand_on' })).toBe('wrong_kind');
    await moved(w, c, c.owner, task.key, { action: 'cancel', reason: 'Not needed' });
    expect(await code(c.owner, task.key, { action: 'cancel' })).toBe('wrong_state');
    expect(await code(c.owner, task.key, { action: 'route', toStepId: stepOf(flow, 'QA').id })).toBe(
      'wrong_state',
    );
  });

  it('refuses a move on a task that moved since the caller saw it', async () => {
    const task = await atDevelop();
    const develop = stepOf(flow, 'Develop').id;
    expect(await code(c.owner, task.key, { action: 'hand_on', fromStepId: null })).toBe('task_moved');
    const res = await act(w, c, c.owner, task.key, { action: 'hand_on', fromStepId: develop });
    expect(res.status).toBe(200);
    expect((await act(w, c, c.owner, task.key, { action: 'pass', fromStepId: develop })).status).toBe(409);
  });

  it('refuses a send-back from a step that names no target', async () => {
    const steps = [
      { name: 'Triage', kind: 'check', assigneePrincipalId: c.tester.principalId },
      { name: 'Build', kind: 'work', assigneePrincipalId: c.developer, starts: 'auto' },
    ];
    const lone = await makeFlow(w, { ...c, lead: c.qaBot }, { steps, name: 'Lone' });
    const task = await makeTask(w, c, c.owner, { flowId: lone.id, stepId: stepOf(lone, 'Triage').id });
    expect(await code(c.tester, task.key, { action: 'send_back', reason: 'x' })).toBe('no_send_back_target');
    const built = await moved(w, c, c.tester, task.key, { action: 'pass' });
    // An `auto` step starts by itself: its `started` row has no actor; its run (S5.3b) is blocked by itself too.
    expect(built.task).toMatchObject({ step: { name: 'Build' }, stepState: 'blocked' });
    expect(built.task.history.at(-2)).toMatchObject({ kind: 'started', actor: null, to: { name: 'Build' } });
    expect(built.task.history.at(-1)).toMatchObject({ kind: 'blocked', actor: null, to: { name: 'Build' } });
    expect(await code(c.tester, task.key, { action: 'hand_on' })).toBe('not_your_step');
  });

  it('lets only the step’s person, the Lead’s people and admins move a task; viewers not at all', async () => {
    const task = await atDevelop();
    expect(await code(c.member, task.key, { action: 'start' })).toBe('not_your_step');
    expect(await code(c.tester, task.key, { action: 'start' })).toBe('not_your_step');
    expect(await code(c.member, task.key, { action: 'cancel' })).toBe('not_lead');
    expect(await code(c.member, task.key, { action: 'route', toStepId: stepOf(flow, 'QA').id })).toBe(
      'not_lead',
    );
    expect(await code(c.viewer, task.key, { action: 'start' })).toBe('forbidden');
    expect((await act(w, c, c.manager, task.key, { action: 'start' })).status).toBe(200);
    const atQa = await moved(w, c, c.admin, task.key, { action: 'route', toStepId: stepOf(flow, 'QA').id });
    expect(atQa.task.history.at(-2)?.actor?.principalId).toBe(c.admin.principalId);
    expect((await act(w, c, c.tester, task.key, { action: 'start' })).status).toBe(200);
    expect((await act(w, c, c.tester, task.key, { action: 'cancel' })).status).toBe(403);
  });

  it('answers 404 for no such task, a malformed key, and another company’s task', async () => {
    const task = await atDevelop();
    expect(await code(c.owner, 'T-999', { action: 'start' })).toBe('task_not_found');
    expect(await code(c.owner, 'nope', { action: 'start' })).toBe('task_not_found');
    const other = await membersCompany(w);
    const theirs = await as(w, other.owner)('POST', tasksPath(other, `/${task.id}/actions`), {
      action: 'start',
    });
    expect(theirs).toMatchObject({ status: 404, body: { error: { code: 'task_not_found' } } });
    const outsider = await as(w, other.owner)('POST', tasksPath(c, `/${task.id}/actions`), {
      action: 'start',
    });
    expect(outsider).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    expect((await act(w, c, c.owner, task.key, { action: 'fly' })).status).toBe(400);
  });
});
