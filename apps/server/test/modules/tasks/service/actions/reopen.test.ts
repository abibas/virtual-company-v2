import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as } from '../../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';
import { handOffNote } from '../../../../fixtures/tasks/reopen.ts';
import {
  act,
  type FlowView,
  historyOf,
  makeFlow,
  makeTask,
  moved,
  stepOf,
  type TaskDetailView,
  type TeamCompany,
  tasksPath,
  teamCompany,
} from '../../../../fixtures/tasks.ts';

let w: AuthWorld;
let c: TeamCompany;
let flow: FlowView;
beforeAll(async () => {
  w = await authWorld();
  c = await teamCompany(w);
  flow = await makeFlow(w, c);
});
afterAll(() => w.t.close());

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

const shown = async (key: string, by = c.owner) =>
  (await as(w, by)('GET', tasksPath(c, `/${key}`))).body as TaskDetailView;

/** A task put into `step` and cancelled there by the owner. */
async function cancelledAt(step: string): Promise<TaskDetailView> {
  const task = await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, step).id });
  await moved(w, c, c.owner, task.key, { action: 'cancel' });
  return task;
}

describe('reopen (T-28): a person who leads the team', () => {
  it('puts a done task back into the step its closing step sends back to, as a new round, its correction kept', async () => {
    const task = await makeTask(w, c, c.owner, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id });
    await moved(w, c, c.manager, task.key, { action: 'hand_on' });
    await moved(w, c, c.manager, task.key, { action: 'pass' });
    await moved(w, c, c.tester, task.key, { action: 'pass' });
    const done = await moved(w, c, c.owner, task.key, { action: 'approve' });
    expect(done.task).toMatchObject({ state: 'done', actions: ['reopen'] });
    expect((await shown(task.key, c.tester)).actions).toEqual([]);
    expect((await shown(task.key, c.viewer)).actions).toEqual([]);

    const reopened = await moved(w, c, c.manager, task.key, {
      action: 'reopen',
      reason: '  The login still fails  ',
      findings: 'Empty passwords pass: login.ts line 12.',
    });
    expect(reopened.outcome).toBe('moved');
    expect(reopened.task).toMatchObject({
      state: 'active',
      step: { name: 'Develop' },
      stepState: 'waiting',
      round: 2,
      closedAt: null,
      assignee: { name: 'Developer', kind: 'agent' },
    });
    expect(reopened.task.actions).not.toContain('reopen');
    expect((await historyOf(w.t.db, task.id)).slice(-2)).toEqual([
      ['reopened', 'Approve', 'Develop', null],
      ['entered', null, 'Develop', 2],
    ]);
    expect(reopened.task.history.find((event) => event.kind === 'reopened')).toMatchObject({
      actor: { principalId: c.manager.principalId },
      reason: 'The login still fails',
    });
    const note = await handOffNote(w.t.db, task.id, 'Approve');
    expect(note).toMatchObject({ round: 1, createdBy: c.manager.principalId, kind: 'note' });
    expect(note?.text).toBe('**Reopened:** The login still fails\n\nEmpty passwords pass: login.ts line 12.');
    const audited = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, task.id), eq(auditLog.action, 'reopen')));
    expect(audited.map((row) => row.field)).toEqual(
      expect.arrayContaining(['state', 'currentStepId', 'closedAt']),
    );
    expect(refusal(await act(w, c, c.owner, task.key, { action: 'reopen', reason: 'Again' }))).toEqual([
      409,
      'wrong_state',
    ]);
  });

  it('is refused for an open task, without a reason, to whoever does not lead, and into a step of no flow', async () => {
    const task = await makeTask(w, c, c.owner, { flowId: flow.id });
    const reopen = (by: TeamCompany['owner'], body: Record<string, unknown> = {}) =>
      act(w, c, by, task.key, { action: 'reopen', reason: 'Wrong', ...body });
    expect(refusal(await reopen(c.owner))).toEqual([409, 'wrong_state']);
    await moved(w, c, c.owner, task.key, { action: 'cancel' });
    expect(refusal(await reopen(c.viewer))).toEqual([403, 'forbidden']);
    expect(refusal(await reopen(c.member))).toEqual([403, 'not_lead']);
    expect(refusal(await reopen(c.tester))).toEqual([403, 'not_lead']);
    expect(refusal(await reopen(c.owner, { reason: undefined }))).toEqual([422, 'reason_required']);
    expect(refusal(await reopen(c.owner, { reason: '   ' }))).toEqual([422, 'reason_required']);
    const unknown = { toStepId: '019a4f0c-0000-7000-8000-000000000000' };
    expect(refusal(await reopen(c.owner, unknown))).toEqual([422, 'unknown_step']);
    expect(await shown(task.key)).toMatchObject({ state: 'cancelled', actions: ['reopen'] });
    expect((await historyOf(w.t.db, task.id)).map(([kind]) => kind)).not.toContain('reopened');
  });

  it('a task cancelled in Queued goes back as if closed at the last step; one cancelled at a step, from there', async () => {
    const queued = await makeTask(w, c, c.owner, { flowId: flow.id });
    await moved(w, c, c.owner, queued.key, { action: 'cancel' });
    const fromQueue = await moved(w, c, c.admin, queued.key, {
      action: 'reopen',
      reason: 'Needed after all',
    });
    expect(fromQueue.task).toMatchObject({ state: 'active', step: { name: 'Develop' }, round: 1 });
    expect((await historyOf(w.t.db, queued.id)).at(-2)).toEqual(['reopened', 'Approve', 'Develop', null]);
    expect((await handOffNote(w.t.db, queued.id, 'Approve'))?.text).toBe('**Reopened:** Needed after all');

    const atReview = await cancelledAt('Code review');
    await moved(w, c, c.owner, atReview.key, { action: 'reopen', reason: 'Not done' });
    expect((await historyOf(w.t.db, atReview.id)).at(-2)).toEqual([
      'reopened',
      'Code review',
      'Develop',
      null,
    ]);
  });

  it('goes into the step asked, when one is given', async () => {
    const task = await cancelledAt('Code review');
    const into = await moved(w, c, c.manager, task.key, {
      action: 'reopen',
      reason: 'Test it again',
      toStepId: stepOf(flow, 'QA').id,
    });
    expect(into.task).toMatchObject({
      state: 'active',
      step: { name: 'QA' },
      stepState: 'waiting',
      round: 1,
      assignee: { principalId: c.tester.principalId },
    });
    expect((await historyOf(w.t.db, task.id)).slice(-2)).toEqual([
      ['reopened', 'Code review', 'QA', null],
      ['entered', null, 'QA', 1],
    ]);
  });

  it('into the closing step itself when it sends back nowhere', async () => {
    const one = await teamCompany(w);
    const single = await makeFlow(w, one, {
      name: 'Writing',
      steps: [{ name: 'Write', kind: 'work', assigneePrincipalId: one.developer }],
    });
    const task = await makeTask(w, one, one.owner, { flowId: single.id, stepId: stepOf(single, 'Write').id });
    await moved(w, one, one.owner, task.key, { action: 'hand_on' });
    const back = await moved(w, one, one.manager, task.key, { action: 'reopen', reason: 'One more line' });
    expect(back.task).toMatchObject({ state: 'active', step: { name: 'Write' }, round: 2, closedAt: null });
    expect((await historyOf(w.t.db, task.id)).at(-2)).toEqual(['reopened', 'Write', 'Write', null]);
  });
});
