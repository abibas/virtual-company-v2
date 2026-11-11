import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardView } from '../../../../src/modules/tasks/schemas/board.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  type FlowView,
  flowsPath,
  makeFlow,
  makeTask,
  moved,
  stepOf,
  type TeamCompany,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
let c: TeamCompany;
let flow: FlowView;
beforeAll(async () => {
  w = await authWorld();
  c = await teamCompany(w);
  flow = await makeFlow(w, c);
});
afterAll(() => w.t.close());

describe('GET /api/companies/:companyId/flows/:flowId/text', () => {
  it('writes the flow as the text table of docs/processes.md, with the names as they are now', async () => {
    const res = await as(w, c.viewer)('GET', flowsPath(c, `/${flow.id}/text`));
    expect(res.status).toBe(200);
    const owner = `Owner ${c.owner.subject}`;
    const tester = c.tester.subject;
    const who = Math.max('Code Reviewer'.length, owner.length, tester.length) + 3;
    const row = (step: string, kind: string, name: string, back: string, to: string, limit: string) =>
      `${step.padEnd(14)}${kind.padEnd(11)}${name.padEnd(who)}${back.padEnd(19)}${to.padEnd(16)}${limit}`;
    expect((res.body as { text: string }).text).toBe(
      [
        'Flow: DEVBOX delivery · Lead: DEVBOX Coordinator',
        '',
        row('Step', 'Kind', 'Who', 'Comes back again', 'Sends back to', 'Limit'),
        row('Develop', 'Work', 'Developer', 'Keep', '—', '—'),
        row('Code review', 'Check', 'Code Reviewer', 'Keep', 'Develop', '3 → Lead'),
        row('QA', 'Check', tester, '—', 'Develop', '2 → Lead'),
        row('Approve', 'Sign-off', owner, '—', 'Develop', '—'),
        '→ Done',
        '',
      ].join('\n'),
    );
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('GET', flowsPath(other, `/${flow.id}/text`))).status).toBe(404);
  });
});

describe('GET /api/companies/:companyId/flows/:flowId/board', () => {
  beforeAll(async () => {
    const at = (name: string) => stepOf(flow, name).id;
    await makeTask(w, c, c.owner, { flowId: flow.id, title: 'Queued low', priority: 'low' }); // T-1
    await makeTask(w, c, c.owner, { flowId: flow.id, title: 'Queued urgent', priority: 'urgent' }); // T-2
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: at('Develop') }); // T-3
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: at('Code review') }); // T-4
    await moved(w, c, c.owner, 'T-4', { action: 'send_back', reason: 'Tests fail' });
    await moved(w, c, c.owner, 'T-4', { action: 'hand_on' });
    for (const n of [5, 6]) {
      await makeTask(w, c, c.owner, { flowId: flow.id, stepId: at('Approve') });
      await moved(w, c, c.owner, `T-${n}`, { action: 'approve' });
    }
    await makeTask(w, c, c.owner, { flowId: flow.id, stepId: at('Code review') }); // T-7 escalated
    for (const reason of ['a', 'b', 'c', 'd']) {
      await moved(w, c, c.owner, 'T-7', { action: 'send_back', reason });
      if (reason !== 'd') await moved(w, c, c.owner, 'T-7', { action: 'hand_on' });
    }
    await makeTask(w, c, c.owner, { flowId: flow.id }); // T-8 cancelled
    await moved(w, c, c.owner, 'T-8', { action: 'cancel' });
  });

  const board = async (query = '') => {
    const res = await as(w, c.viewer)('GET', flowsPath(c, `/${flow.id}/board${query}`));
    expect(res.status).toBe(200);
    return res.body as BoardView;
  };

  it('has Queued, each step, Done and Escalated, cards the most urgent and then the oldest first', async () => {
    const view = await board();
    expect(view.flow).toMatchObject({
      id: flow.id,
      name: 'DEVBOX delivery',
      lead: { name: 'DEVBOX Coordinator' },
    });
    expect(
      view.columns.map((col) => [col.kind, col.title, col.cards.map((card) => card.key), col.total]),
    ).toEqual([
      ['queued', 'Queued', ['T-2', 'T-1'], 2],
      ['step', 'Develop', ['T-3'], 1],
      ['step', 'Code review', ['T-4'], 1],
      ['step', 'QA', [], 0],
      ['step', 'Approve', [], 0],
      ['done', 'Done', ['T-6', 'T-5'], 2],
      ['escalated', 'Escalated', ['T-7'], 1],
    ]);
    const [queued, develop, review] = view.columns;
    expect(develop?.step).toMatchObject({ kind: 'work', assignee: { name: 'Developer' } });
    expect(queued?.cards[0]).toMatchObject({ priority: 'urgent', round: null, assignee: null, stepId: null });
    expect(review?.cards[0]).toMatchObject({
      round: 2,
      stepState: 'waiting',
      assignee: { name: 'Code Reviewer' },
      stepId: stepOf(flow, 'Code review').id,
    });
    expect(view.columns.at(-1)?.cards[0]).toMatchObject({
      round: 4,
      stepState: null,
      assignee: { name: 'DEVBOX Coordinator' },
    });
  });

  it('shows as many done tasks as asked, still counting them all', async () => {
    const done = (await board('?done=1')).columns.find((col) => col.kind === 'done');
    expect([done?.cards.map((card) => card.key), done?.total]).toEqual([['T-6'], 2]);
    expect((await board('?done=0')).columns.find((col) => col.kind === 'done')?.cards).toEqual([]);
    expect((await as(w, c.viewer)('GET', flowsPath(c, `/${flow.id}/board?done=51`))).status).toBe(400);
    expect(
      (await as(w, c.viewer)('GET', flowsPath(c, '/019a4f0c-0000-7000-8000-000000000000/board'))).status,
    ).toBe(404);
  });
});
