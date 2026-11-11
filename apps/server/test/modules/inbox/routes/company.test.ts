import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { endTurnOf, inboxOf, inboxPath, shortOf } from '../../../fixtures/inbox.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  act,
  type FlowView,
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

/**
 * Acme's DEVBOX flow (fixtures/tasks.ts): Develop (Developer), Code review (Code Reviewer, back to Develop, 3), QA (the
 * tester, back to Develop, 2), Approve (the owner's Sign-off). The Lead agent reports to the manager, under the owner:
 * the Lead's people are the manager and the owner; the admin, the member and the viewer are beside them.
 */
describe('GET /api/companies/:companyId/inbox: tasks', () => {
  let c: TeamCompany;
  let flow: FlowView;
  beforeEach(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  /** A new task put at `step` by the manager (one of the Lead's people). */
  const at = async (step: string, body: Record<string, unknown> = {}) =>
    makeTask(w, c, c.manager, { flowId: flow.id, stepId: stepOf(flow, step).id, ...body });

  it("shows a Sign-off to its person, with who handed it on and the moves they may make, until it's approved", async () => {
    const task = await at('Develop', { title: 'Ship the login' });
    await moved(w, c, c.manager, task.key, { action: 'hand_on' });
    await moved(w, c, c.manager, task.key, { action: 'pass' });
    await moved(w, c, c.tester, task.key, { action: 'pass' });
    const inbox = await inboxOf(w, c.owner, c);
    expect(inbox.count).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      id: `task:${task.id}`,
      kind: 'signoff',
      company: { id: c.companyId },
      title: 'Ship the login',
      subtitle: 'DEVBOX delivery · Approve',
      reason: null,
      from: { principalId: c.tester.principalId, kind: 'person' },
      link: `tasks/${task.key}`,
      task: {
        key: task.key,
        priority: 'normal',
        flow: { id: flow.id, name: 'DEVBOX delivery', lead: { name: 'DEVBOX Coordinator' } },
        step: { name: 'Approve', kind: 'signoff' },
        round: 1,
      },
      question: null,
    });
    expect(inbox.items[0]?.actions).toEqual(expect.arrayContaining(['approve', 'send_back', 'cancel']));
    // Nobody else waits on it: the manager leads the team, but the Sign-off is the owner's.
    for (const person of [c.manager, c.admin, c.member, c.tester]) {
      expect((await inboxOf(w, person, c)).items).toEqual([]);
    }
    await moved(w, c, c.owner, task.key, { action: 'approve' });
    expect(await inboxOf(w, c.owner, c)).toEqual({ items: [], count: 0 });
  });

  it("shows a person's other step to them (QA, waiting), and a send-back's reason on the step it came back to", async () => {
    const task = await at('QA');
    const tester = await inboxOf(w, c.tester, c);
    expect(shortOf(tester.items)).toEqual([['step', task.key, 'DEVBOX delivery · QA']]);
    expect(tester.items[0]?.from).toMatchObject({ principalId: c.manager.principalId });
    expect(tester.items[0]?.actions).toEqual(['start', 'pass', 'send_back']);
    // The owner sends it back from Approve to Develop, an agent's step: it leaves the tester's inbox.
    await moved(w, c, c.tester, task.key, { action: 'pass' });
    const back = await act(w, c, c.owner, task.key, { action: 'send_back', reason: 'The copy is wrong' });
    expect(back.status).toBe(200);
    expect((await inboxOf(w, c.tester, c)).items).toEqual([]);
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);
  });

  it("shows an escalated task to the Lead's people, with its reason and who escalated it", async () => {
    const task = await at('Code review', { priority: 'high' });
    for (const round of [1, 2, 3]) {
      await moved(w, c, c.admin, task.key, { action: 'send_back', reason: `Round ${round}` });
      await moved(w, c, c.manager, task.key, { action: 'hand_on' });
    }
    await moved(w, c, c.admin, task.key, { action: 'send_back', reason: 'Still failing' });
    for (const person of [c.manager, c.owner]) {
      const [item, ...rest] = (await inboxOf(w, person, c)).items;
      expect(rest).toEqual([]);
      expect(item).toMatchObject({
        kind: 'escalated',
        subtitle: 'DEVBOX delivery · Code review',
        reason: 'Code review sent it back 3 times already, its limit; this time: Still failing',
        from: { principalId: c.admin.principalId },
        task: { priority: 'high', step: { name: 'Code review' }, round: null },
      });
      expect(item?.actions).toEqual(['route', 'retry', 'cancel']);
    }
    // The admin moved it, but is not above the Lead on the chart; the member and the viewer neither.
    for (const person of [c.admin, c.member, c.viewer])
      expect((await inboxOf(w, person, c)).items).toEqual([]);
    await moved(w, c, c.manager, task.key, { action: 'retry' });
    expect((await inboxOf(w, c.manager, c)).items).toEqual([]);
  });

  it("shows a blocked task to the Lead's people, naming the step's agent when the block came by itself", async () => {
    const task = await at('Develop');
    // Start runs the Developer's step: it has no placement, so the task is blocked.
    await moved(w, c, c.manager, task.key, { action: 'start' });
    const [item] = (await inboxOf(w, c.manager, c)).items;
    expect(item).toMatchObject({
      kind: 'blocked',
      subtitle: 'DEVBOX delivery · Develop',
      reason: 'The agent has no placement: choose where it runs first',
      from: { name: 'Developer', kind: 'agent', slug: 'developer' },
      task: { round: 1 },
    });
    expect(item?.actions).toEqual(expect.arrayContaining(['start', 'hand_on', 'route', 'cancel']));
    expect(shortOf((await inboxOf(w, c.owner, c)).items)).toEqual([
      ['blocked', task.key, 'DEVBOX delivery · Develop'],
    ]);
    expect((await inboxOf(w, c.admin, c)).items).toEqual([]);
  });

  it("shows a turn that ended without a hand-off to the Lead's people, then to nobody once it moves on", async () => {
    const task = await at('Develop');
    await endTurnOf(w.t.db, c.companyId, task.id, 'Stopped by the owner');
    const [item] = (await inboxOf(w, c.owner, c)).items;
    expect(item).toMatchObject({
      kind: 'turn_ended',
      reason: 'Stopped by the owner',
      from: { name: 'Developer' },
    });
    await moved(w, c, c.manager, task.key, { action: 'hand_on' });
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);
  });

  it('orders the items the most urgent first, and counts them for a badge', async () => {
    const signoff = await at('Approve', { title: 'Approve me' });
    const blocked = await at('Develop', { priority: 'urgent' });
    await moved(w, c, c.manager, blocked.key, { action: 'start' });
    const ended = await at('Code review');
    await endTurnOf(w.t.db, c.companyId, ended.id);
    const queued = await makeTask(w, c, c.manager, { flowId: flow.id });
    const keys = (await inboxOf(w, c.owner, c)).items.map((item) => [item.kind, item.task?.key]);
    expect(keys).toEqual([
      ['blocked', blocked.key],
      ['signoff', signoff.key],
      ['turn_ended', ended.key],
    ]);
    expect(keys.flat()).not.toContain(queued.key);
    const count = await as(w, c.owner)('GET', inboxPath(c, '/count'));
    expect([count.status, count.body]).toEqual([200, { count: 3 }]);
  });

  it("is a viewer's empty inbox even at their own step, and another company's is a 404", async () => {
    const other = await teamCompany(w);
    const steps = [{ name: 'Look', kind: 'signoff', assigneePrincipalId: other.viewer.principalId }];
    const otherFlow = await makeFlow(w, other, { steps });
    await makeTask(w, other, other.owner, { flowId: otherFlow.id, stepId: stepOf(otherFlow, 'Look').id });
    expect((await inboxOf(w, other.viewer, other)).items).toEqual([]);
    // Acme's owner reads nothing of the other company, and the other company's people nothing of Acme.
    const outsider = await membersCompany(w);
    for (const [person, company] of [
      [c.owner, other],
      [outsider.owner, c],
    ] as const) {
      const res = await as(w, person)('GET', inboxPath(company));
      expect([res.status, (res.body as { error: { code: string } }).error.code]).toEqual([404, 'not_found']);
    }
    expect((await inboxOf(w, outsider.owner, outsider)).items).toEqual([]);
  });
});
