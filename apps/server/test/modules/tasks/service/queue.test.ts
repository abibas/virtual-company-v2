import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { boardOf, edited, errorCode, patchTask, queuedKeys, shown } from '../../../fixtures/tasks/queue.ts';
import { makeFlow, makeTask, moved, stepOf, type TeamCompany, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** A team, its DEVBOX flow, and tasks made in it (queued unless said) as the member. */
async function team() {
  const c = await teamCompany(w);
  const flow = await makeFlow(w, c);
  const task = (body: Record<string, unknown> = {}) => makeTask(w, c, c.member, { flowId: flow.id, ...body });
  const queued = () => queuedKeys(w, c, flow.id);
  return { c, flow, task, queued };
}

/** The `edited` rows' details of a task's history, oldest first. */
const editsOf = async (c: TeamCompany, key: string) =>
  (await shown(w, c, key)).history.filter((e) => e.kind === 'edited').map((e) => e.details);

describe('a queued task’s place (PATCH before / after, T-39)', () => {
  it('puts it right before or after another queued task, taking that task’s priority unless one is given', async () => {
    const s = await team();
    for (const priority of ['normal', 'normal', 'normal', 'high']) await s.task({ priority });
    expect(await s.queued()).toEqual(['T-4', 'T-1', 'T-2', 'T-3']);
    const kept = (await shown(w, s.c, 'T-1')).updatedAt;
    expect(await edited(w, s.c, s.c.manager, 'T-3', { before: 'T-1' })).toMatchObject({
      priority: 'normal',
      queue: { place: 2, of: 4 },
    });
    expect(await s.queued()).toEqual(['T-4', 'T-3', 'T-1', 'T-2']);
    // Only the placed task changed: the others only shifted.
    expect((await shown(w, s.c, 'T-1')).updatedAt).toBe(kept);
    // A place it has already writes nothing.
    await edited(w, s.c, s.c.owner, 'T-3', { before: 'T-1' });
    expect(await editsOf(s.c, 'T-3')).toEqual([{ fields: ['queue'] }]);
    expect(await edited(w, s.c, s.c.owner, 't-2', { after: 'T-4' })).toMatchObject({
      priority: 'high',
      queue: { place: 2, of: 4 },
    });
    expect(await s.queued()).toEqual(['T-4', 'T-2', 'T-3', 'T-1']);
    // A priority given is kept: the queue goes by priority first.
    const low = await edited(w, s.c, s.c.admin, 'T-1', { before: 'T-4', priority: 'low' });
    expect(low).toMatchObject({ priority: 'low', queue: { place: 4, of: 4 } });
    expect(await editsOf(s.c, 'T-2')).toEqual([{ fields: ['priority', 'queue'] }]);
  });

  it('is for those who route, beside another queued task of its flow; a refusal changes nothing', async () => {
    const s = await team();
    await s.task(); // T-1
    await s.task(); // T-2
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id }); // T-3
    const other = await makeFlow(w, { ...s.c, lead: s.c.qaBot }, { name: 'Other' });
    await makeTask(w, s.c, s.c.owner, { flowId: other.id }); // T-4
    const refusals = [
      [s.c.tester, 'T-2', { after: 'T-1' }, 403, 'not_yours'],
      [s.c.member, 'T-2', { before: 'T-1' }, 403, 'not_lead'],
      [s.c.owner, 'T-2', { before: 'T-2', priority: 'urgent' }, 422, 'same_task'],
      [s.c.owner, 'T-2', { after: 'T-3', priority: 'urgent' }, 422, 'target_not_queued'],
      [s.c.owner, 'T-2', { after: 'T-4' }, 422, 'unknown_task'],
      [s.c.owner, 'T-2', { after: 'T-99' }, 422, 'unknown_task'],
      [s.c.owner, 'T-2', { after: 'nonsense' }, 422, 'unknown_task'],
      [s.c.owner, 'T-3', { after: 'T-1' }, 409, 'not_queued'],
      [s.c.owner, 'T-3', { waitsFor: [] }, 409, 'not_queued'],
    ] as const;
    for (const [by, key, body, status, code] of refusals) {
      const res = await patchTask(w, s.c, by, key, body);
      expect([res.status, errorCode(res)], JSON.stringify(body)).toEqual([status, code]);
    }
    const message = async (body: Record<string, unknown>) =>
      ((await patchTask(w, s.c, s.c.owner, 'T-2', body)).body as { error: { message: string } }).error
        .message;
    expect(await message({ after: 'T-3' })).toBe('T-3 is not queued: place a task among the queued ones');
    expect(await message({ after: 't-4' })).toBe('No task T-4 in the flow "DEVBOX delivery"');
    expect(await message({ before: 'T-2' })).toBe('A task cannot be put before or after itself');
    expect((await patchTask(w, s.c, s.c.owner, 'T-2', { before: 'T-1', after: 'T-1' })).status).toBe(400);
    expect(await s.queued()).toEqual(['T-1', 'T-2']);
    expect(await shown(w, s.c, 'T-2')).toMatchObject({ priority: 'normal', queue: { place: 2, of: 2 } });
    expect(await editsOf(s.c, 'T-2')).toEqual([]);
    // Its creator, who does not route, still says what it waits for.
    expect((await edited(w, s.c, s.c.member, 'T-2', { waitsFor: ['T-1'] })).waitsFor).toMatchObject([
      { key: 'T-1' },
    ]);
  });
});

describe('what a queued task waits for (PATCH waitsFor, T-39)', () => {
  it('takes keys or ids, each once, shows them by number, writes nothing when the same, and [] drops them', async () => {
    const s = await team();
    for (const title of ['Schema', 'API', 'Web']) await s.task({ title });
    const [schema, api] = [await shown(w, s.c, 'T-1'), await shown(w, s.c, 'T-2')];
    const web = await edited(w, s.c, s.c.member, 'T-3', { waitsFor: ['t-2', 'T-1', api.id, ' T-1 '] });
    expect(web.waitsFor).toEqual([
      { id: schema.id, key: 'T-1', title: 'Schema', state: 'queued' },
      { id: api.id, key: 'T-2', title: 'API', state: 'queued' },
    ]);
    await edited(w, s.c, s.c.member, 'T-3', { waitsFor: ['T-1', 'T-2'] });
    expect((await edited(w, s.c, s.c.member, 'T-3', { waitsFor: [] })).waitsFor).toEqual([]);
    await edited(w, s.c, s.c.member, 'T-3', { waitsFor: [] });
    expect(await editsOf(s.c, 'T-3')).toEqual([
      { fields: ['waitsFor'], waitsFor: ['T-2', 'T-1'] },
      { fields: ['waitsFor'], waitsFor: [] },
    ]);
  });

  it('refuses itself, a cycle through other waits and another flow’s task; a diamond is no cycle', async () => {
    const s = await team();
    for (const n of [1, 2, 3, 4, 5]) await s.task({ title: `Task ${n}` });
    await edited(w, s.c, s.c.member, 'T-1', { waitsFor: ['T-2', 'T-3'] });
    await edited(w, s.c, s.c.member, 'T-2', { waitsFor: ['T-4'] });
    await edited(w, s.c, s.c.member, 'T-3', { waitsFor: ['T-4'] });
    expect((await edited(w, s.c, s.c.member, 'T-5', { waitsFor: ['T-1'] })).waitsFor).toHaveLength(1);
    const other = await makeFlow(w, { ...s.c, lead: s.c.qaBot }, { name: 'Other' });
    await makeTask(w, s.c, s.c.owner, { flowId: other.id }); // T-6
    const refused = async (key: string, body: Record<string, unknown>) => {
      const res = await patchTask(w, s.c, s.c.member, key, body);
      return [res.status, errorCode(res), (res.body as { error: { message: string } }).error.message];
    };
    expect(await refused('T-4', { waitsFor: ['T-5'], priority: 'urgent' })).toEqual([
      422,
      'wait_cycle',
      'T-5 already waits (through the tasks it waits for) for this task: that would be a cycle',
    ]);
    expect(await refused('T-4', { waitsFor: ['T-4'] })).toEqual([
      422,
      'waits_for_itself',
      'A task cannot wait for itself',
    ]);
    expect((await refused('T-4', { waitsFor: ['T-6'] })).slice(0, 2)).toEqual([422, 'unknown_task']);
    expect(await shown(w, s.c, 'T-4')).toMatchObject({ priority: 'normal', waitsFor: [] });
    // Once nothing it waits for waits for it, it may.
    await edited(w, s.c, s.c.member, 'T-1', { waitsFor: ['T-3'] });
    await edited(w, s.c, s.c.member, 'T-3', { waitsFor: [] });
    expect((await edited(w, s.c, s.c.member, 'T-4', { waitsFor: ['T-1'] })).waitsFor).toHaveLength(1);
  });
});

describe('the queue in the views (T-34, T-39)', () => {
  it('Queued by priority then place, its cards’ Autotake and waits; the task its place and what it waits for', async () => {
    const s = await team();
    await s.task({ title: 'Schema' }); // T-1
    await s.task({ title: 'API', autoTake: true, waitsFor: ['T-1'] }); // T-2
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id }); // T-3
    await s.task({ title: 'Web', priority: 'high', waitsFor: ['T-3', 'T-2'] }); // T-4
    await moved(w, s.c, s.c.owner, 'T-1', { action: 'cancel' });
    const board = await boardOf(w, s.c, s.flow.id);
    expect(board.flow).toMatchObject({ newTaskStepId: null, newTaskAutoTake: false });
    const [queued, develop] = board.columns;
    expect(queued?.cards.map((card) => [card.key, card.autoTake, card.waitsFor])).toEqual([
      [
        'T-4',
        false,
        [
          { key: 'T-2', closed: false },
          { key: 'T-3', closed: false },
        ],
      ],
      ['T-2', true, [{ key: 'T-1', closed: true }]],
    ]);
    expect(develop?.cards.map((card) => [card.key, card.waitsFor])).toEqual([['T-3', []]]);
    expect(await shown(w, s.c, 'T-2')).toMatchObject({
      autoTake: true,
      queue: { place: 2, of: 2 },
      waitsFor: [{ key: 'T-1', title: 'Schema', state: 'cancelled' }],
    });
    expect(await shown(w, s.c, 'T-4')).toMatchObject({
      queue: { place: 1, of: 2 },
      waitsFor: [
        { key: 'T-2', state: 'queued' },
        { key: 'T-3', state: 'active' },
      ],
    });
    expect(await shown(w, s.c, 'T-3')).toMatchObject({ queue: null, waitsFor: [] });
  });
});
