import { auditLog, sprints } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardView } from '../../../../src/modules/tasks/schemas/board.ts';
import { as } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  backdate,
  madeAt,
  sprintIdOf,
  sprintList,
  sprintOf,
  sprintRows,
  sprintsPath,
  startSprint,
} from '../../../fixtures/tasks/sprints.ts';
import {
  type FlowView,
  flowsPath,
  makeFlow,
  makeTask,
  moved,
  stepOf,
  type TaskDetailView,
  type TeamCompany,
  teamCompany,
} from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

const board = async (c: TeamCompany, flow: FlowView) => {
  const res = await as(w, c.viewer)('GET', flowsPath(c, `/${flow.id}/board`));
  expect(res.status).toBe(200);
  return res.body as BoardView;
};

const UNKNOWN = '019a4f0c-0000-7000-8000-000000000000';

describe('GET /api/companies/:companyId/flows/:flowId/sprints', () => {
  it('a new flow has its Sprint 1, current, started when the flow was made by whoever made it', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const list = await sprintList(w, c, c.viewer, flow.id);
    expect(list).toEqual([
      {
        id: expect.any(String),
        number: 1,
        name: 'Sprint 1',
        current: true,
        startedAt: flow.createdAt,
        startedBy: expect.objectContaining({ principalId: c.owner.principalId, kind: 'person' }),
        endedAt: null,
        endedBy: null,
        done: 0,
        cancelled: 0,
        carriedOver: 0,
        created: 0,
      },
    ]);
    const one = await sprintOf(w, c, c.viewer, { flowId: flow.id, sprintId: list[0]?.id as string });
    expect(one).toMatchObject({ number: 1, current: true });
    expect(one.report).toEqual({ done: [], cancelled: [], carriedOver: [], created: 0 });
    expect(refusal(await as(w, c.viewer)('GET', sprintsPath(c, UNKNOWN)))).toEqual([404, 'flow_not_found']);
    const other = await teamCompany(w);
    expect(refusal(await as(w, other.owner)('GET', sprintsPath(other, flow.id)))).toEqual([
      404,
      'flow_not_found',
    ]);
  });

  it('a flow without a current sprint gets its Sprint 1 when read, as it was made', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c, { by: c.manager });
    await rawDb(w.t.db).delete(sprints).where(eq(sprints.flowId, flow.id));
    const [first] = await sprintList(w, c, c.owner, flow.id);
    expect(first).toMatchObject({
      number: 1,
      name: 'Sprint 1',
      current: true,
      startedAt: flow.createdAt,
      startedBy: { principalId: c.manager.principalId },
    });
    expect(await sprintRows(w.t.db, flow.id)).toHaveLength(1);
  });
});

describe('GET /api/companies/:companyId/flows/:flowId/sprints/:sprintId', () => {
  it('is 404 sprint_not_found for an unknown, malformed or another flow’s sprint', async () => {
    const c = await teamCompany(w);
    const flow = await makeFlow(w, c);
    const other = await teamCompany(w);
    const theirs = await makeFlow(w, other);
    const [their] = await sprintList(w, other, other.owner, theirs.id);
    for (const id of [UNKNOWN, 'not-a-sprint', their?.id as string]) {
      const res = await as(w, c.viewer)('GET', sprintsPath(c, flow.id, `/${id}`));
      expect(refusal(res), id).toEqual([404, 'sprint_not_found']);
    }
    const noFlow = await as(w, c.viewer)('GET', sprintsPath(c, UNKNOWN, `/${their?.id}`));
    expect(refusal(noFlow)).toEqual([404, 'flow_not_found']);
  });
});

describe('POST /api/companies/:companyId/flows/:flowId/sprints', () => {
  let c: TeamCompany;
  let flow: FlowView;
  const made: Record<string, TaskDetailView> = {};
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
    const at = (name: string) => stepOf(flow, name).id;
    const task = async (body: Record<string, unknown>) => {
      const one = await makeTask(w, c, c.owner, { flowId: flow.id, ...body });
      made[one.key] = one;
      return one.key;
    };
    await task({ title: 'Queued one', priority: 'high' }); // T-1, carried over from Queued
    await task({ stepId: at('Develop') }); // T-2, carried over from Develop
    const escalated = await task({ stepId: at('Code review') }); // T-3, carried over escalated
    for (const reason of ['a', 'b', 'c', 'd']) {
      await moved(w, c, c.owner, escalated, { action: 'send_back', reason });
      if (reason !== 'd') await moved(w, c, c.owner, escalated, { action: 'hand_on' });
    }
    await moved(w, c, c.owner, await task({ stepId: at('Approve') }), { action: 'approve' }); // T-4 done
    await moved(w, c, c.owner, await task({ title: 'Not needed' }), { action: 'cancel' }); // T-5 cancelled
    await backdate(w.t.db, flow.id, {
      started: new Date('2026-11-02T08:00:00.000Z'),
      created: new Date('2026-11-02T09:00:00.000Z'),
    });
  });

  it('is refused below member, to whoever does not lead the team, for a bad name or flow; nothing changes', async () => {
    const post = (by: TeamCompany['owner'], body: unknown = {}, flowId = flow.id) =>
      as(w, by)('POST', sprintsPath(c, flowId), body);
    expect(refusal(await post(c.viewer))).toEqual([403, 'forbidden']);
    expect(refusal(await post(c.member))).toEqual([403, 'not_lead']);
    expect(refusal(await post(c.tester))).toEqual([403, 'not_lead']);
    for (const name of ['', '   ', 'x'.repeat(81), 7]) {
      expect((await post(c.manager, { name })).status, String(name)).toBe(400);
    }
    expect(refusal(await post(c.owner, {}, UNKNOWN))).toEqual([404, 'flow_not_found']);
    expect(await sprintRows(w.t.db, flow.id)).toMatchObject([{ number: 1, endedAt: null, report: null }]);
  });

  it('ends the current sprint with its report and starts the next one with the open tasks carried over', async () => {
    const next = await startSprint(w, c, c.manager, flow.id);
    const carried = [
      { key: 'T-1', title: 'Queued one', where: 'Queued' },
      { key: 'T-2', title: 'Fix the login', where: 'Develop' },
      { key: 'T-3', title: 'Fix the login', where: 'Escalated from Code review' },
    ];
    expect(next).toEqual({
      id: expect.any(String),
      number: 2,
      name: 'Sprint 2 · Tue 3 Nov',
      current: true,
      startedAt: TEST_NOW,
      startedBy: expect.objectContaining({ principalId: c.manager.principalId }),
      endedAt: null,
      endedBy: null,
      done: 0,
      cancelled: 0,
      carriedOver: 3,
      created: 0,
      report: { done: [], cancelled: [], carriedOver: carried, created: 0 },
    });
    const list = await sprintList(w, c, c.viewer, flow.id);
    const counts = list.map((s) => [s.number, s.current, s.endedAt, s.endedBy?.principalId ?? null]);
    expect(counts).toEqual([
      [2, true, null, null],
      [1, false, TEST_NOW, c.manager.principalId],
    ]);
    expect(list[1]).toMatchObject({ done: 1, cancelled: 1, carriedOver: 3, created: 5 });
    const ended = await sprintOf(w, c, c.viewer, { flowId: flow.id, sprintId: list[1]?.id as string });
    expect(ended.report).toEqual({
      done: [{ key: 'T-4', title: 'Fix the login', priority: 'normal', closedAt: TEST_NOW }],
      cancelled: [{ key: 'T-5', title: 'Not needed', priority: 'normal', closedAt: TEST_NOW }],
      carriedOver: carried,
      created: 5,
    });
    const where = async (key: string) => sprintIdOf(w.t.db, made[key]?.id as string);
    expect(await Promise.all(['T-1', 'T-2', 'T-3', 'T-4', 'T-5'].map(where))).toEqual([
      next.id,
      next.id,
      next.id,
      ended.id,
      ended.id,
    ]);
    const audited = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, c.companyId), eq(auditLog.entityType, 'sprint')));
    expect(new Set(audited.map((row) => `${row.entityId} ${row.action}`))).toEqual(
      new Set([`${ended.id} end`, `${next.id} create`]),
    );
    expect(new Set(audited.map((row) => row.actorPrincipalId))).toEqual(new Set([c.manager.principalId]));
  });

  it('flips the board: its sprint is the new one, and Done holds only the closed tasks of it', async () => {
    const view = await board(c, flow);
    expect(view.sprint).toEqual({
      id: expect.any(String),
      number: 2,
      name: 'Sprint 2 · Tue 3 Nov',
      startedAt: TEST_NOW,
      startedBy: expect.objectContaining({ principalId: c.manager.principalId }),
      done: 0,
      cancelled: 0,
    });
    const columns = view.columns.map((col) => [col.title, col.cards.map((card) => card.key), col.total]);
    expect(columns).toEqual([
      ['Queued', ['T-1'], 1],
      ['Develop', ['T-2'], 1],
      ['Code review', [], 0],
      ['QA', [], 0],
      ['Approve', [], 0],
      ['Done', [], 0],
      ['Escalated', ['T-3'], 1],
    ]);
  });

  it('counts the current sprint live, and the ended one keeps the report written when it ended', async () => {
    await moved(w, c, c.manager, 'T-1', { action: 'cancel' });
    const t6 = await makeTask(w, c, c.owner, { flowId: flow.id, title: 'New one' });
    await madeAt(w.t.db, t6.id, new Date('2026-11-03T13:00:00.000Z'));
    const view = await board(c, flow);
    expect(view.sprint).toMatchObject({ number: 2, done: 0, cancelled: 1 });
    const done = view.columns.find((col) => col.kind === 'done');
    expect(done?.cards.map((card) => [card.key, card.cancelled])).toEqual([['T-1', true]]);
    expect(done?.total).toBe(1);
    const [current, first] = await sprintList(w, c, c.viewer, flow.id);
    expect(current).toMatchObject({ number: 2, done: 0, cancelled: 1, carriedOver: 3, created: 1 });
    expect(first).toMatchObject({ number: 1, done: 1, cancelled: 1, carriedOver: 3, created: 5 });
    const live = await sprintOf(w, c, c.viewer, { flowId: flow.id, sprintId: current?.id as string });
    expect(live.report.carriedOver.map((task) => task.key)).toEqual(['T-2', 'T-3', 'T-6']);
    expect(live.report.cancelled.map((task) => task.key)).toEqual(['T-1']);

    // An admin names the next one; the one it ends keeps what it had then.
    w.clock.set('2026-11-04T09:00:00.000Z');
    const third = await startSprint(w, c, c.admin, flow.id, { name: '  Release week  ' });
    w.clock.set(TEST_NOW);
    expect(third).toMatchObject({
      number: 3,
      name: 'Release week',
      startedBy: { principalId: c.admin.principalId },
    });
    const second = await sprintOf(w, c, c.viewer, { flowId: flow.id, sprintId: current?.id as string });
    expect(second).toMatchObject({
      current: false,
      endedAt: '2026-11-04T09:00:00.000Z',
      endedBy: { principalId: c.admin.principalId },
      done: 0,
      cancelled: 1,
      carriedOver: 3,
      created: 1,
    });
    expect(second.report.carriedOver.map((task) => task.key)).toEqual(['T-2', 'T-3', 'T-6']);
    expect((await board(c, flow)).sprint).toMatchObject({ number: 3, name: 'Release week', cancelled: 0 });
  });

  it('a reopened task joins the current sprint; the sprint it was done in keeps it in its report', async () => {
    const [, , first] = await sprintList(w, c, c.viewer, flow.id);
    await moved(w, c, c.owner, 'T-4', { action: 'reopen', reason: 'The login still fails' });
    const rows = await sprintRows(w.t.db, flow.id);
    expect(await sprintIdOf(w.t.db, made['T-4']?.id as string)).toBe(rows.at(-1)?.id);
    const ended = await sprintOf(w, c, c.viewer, { flowId: flow.id, sprintId: first?.id as string });
    expect(ended.report.done.map((task) => task.key)).toEqual(['T-4']);
    expect(
      (await board(c, flow)).columns.find((col) => col.title === 'Develop')?.cards.map((x) => x.key),
    ).toEqual(['T-2', 'T-4']);
  });
});
