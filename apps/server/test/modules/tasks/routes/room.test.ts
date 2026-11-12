import { ROOM_MESSAGE_MAX } from '@mwc/shared/flows';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomView } from '../../../../src/modules/tasks/schemas/room.ts';
import { as } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';
import {
  type FlowView,
  flowsPath,
  makeFlow,
  type TeamCompany,
  teamCompany,
} from '../../../fixtures/tasks.ts';

/**
 * `GET|PUT …/flows/{flowId}/room` and `POST …/room/messages` (docs/processes.md "The team room"): anyone of the company
 * reads the room; the team's people (the Lead's people, those placed under the Lead, each step's person) and the
 * company's admins and owners write; those who lead the team set its cap, audited on the flow. Here no agent is placed,
 * so each message says who was not asked.
 */

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const errorCode = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;
const NO_PLACEMENT = 'The agent has no placement: choose where it runs first';

describe('a flow’s team room', () => {
  let c: TeamCompany;
  let flow: FlowView;
  const path = (rest = '') => flowsPath(c, `/${flow.id}/room${rest}`);
  const post = (by: Person, body: unknown) => as(w, by)('POST', path('/messages'), body);
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('is read by anyone of the company: who is in it, and whether they write there', async () => {
    const res = await as(w, c.viewer)('GET', path());
    expect(res.status).toBe(200);
    const room = res.body as RoomView;
    expect(room.flow).toEqual({ id: flow.id, name: 'DEVBOX delivery', leadPrincipalId: c.lead });
    expect(room.members.agents.map((a) => [a.principalId, a.name])).toEqual([
      [c.lead, 'DEVBOX Coordinator'],
      [c.developer, 'Developer'],
      [c.reviewer, 'Code Reviewer'],
    ]);
    expect(room.members.people.map((p) => p.principalId)).toEqual([
      c.manager.principalId,
      c.owner.principalId,
      c.tester.principalId,
    ]);
    expect(room).toMatchObject({ mayWrite: false, messages: [], nextBefore: null, replying: [] });
    expect(room.cap).toEqual({ maxPerHour: 30, askedLastHour: 0 });
    const writes = async (by: Person) => ((await as(w, by)('GET', path())).body as RoomView).mayWrite;
    expect(await writes(c.member)).toBe(false);
    for (const by of [c.tester, c.manager, c.admin, c.owner]) expect(await writes(by)).toBe(true);
  });

  it('takes a message from the team’s people and admins, and says which agents were not asked', async () => {
    const res = await post(c.tester, { body: '  Is T-2 ready?  ' });
    expect(res.status).toBe(201);
    const room = res.body as RoomView;
    expect(room.messages.map((m) => [m.kind, m.author?.principalId ?? null, m.body, m.asked])).toEqual([
      ['message', c.tester.principalId, 'Is T-2 ready?', 0],
      [
        'notice',
        null,
        `Not asked:\n- DEVBOX Coordinator: ${NO_PLACEMENT}\n- Developer: ${NO_PLACEMENT}\n- Code Reviewer: ${NO_PLACEMENT}`,
        null,
      ],
    ]);
    const named = (await post(c.admin, { body: '@Code Reviewer please look' })).body as RoomView;
    expect(named.messages.at(-2)).toMatchObject({ kind: 'message', to: [c.reviewer] });
    expect(named.messages.at(-1)?.body).toBe(`Code Reviewer was not asked: ${NO_PLACEMENT}`);
  });

  it('refuses a member outside the team, a viewer, a bad body, and another company’s room', async () => {
    const outside = await post(c.member, { body: 'Hi' });
    expect(outside.status).toBe(403);
    expect(errorCode(outside)).toBe('not_in_team');
    expect((await post(c.viewer, { body: 'Hi' })).status).toBe(403);
    expect((await post(c.owner, { body: '   ' })).status).toBe(400);
    expect((await post(c.owner, { body: 'x'.repeat(ROOM_MESSAGE_MAX + 1) })).status).toBe(400);
    const other = await teamCompany(w);
    const theirs = await makeFlow(w, other);
    expect((await as(w, c.owner)('GET', flowsPath(c, `/${theirs.id}/room`))).status).toBe(404);
    expect(
      (await as(w, c.owner)('POST', flowsPath(c, `/${theirs.id}/room/messages`), { body: 'Hi' })).status,
    ).toBe(404);
    expect(errorCode(await as(w, c.owner)('GET', flowsPath(c, '/not-an-id/room')))).toBe('flow_not_found');
  });

  it('sets the cap for those who lead the team, audited on the flow; refuses others and out of bounds', async () => {
    const res = await as(w, c.manager)('PUT', path(), { maxPerHour: 5 });
    expect(res.status).toBe(200);
    expect((res.body as RoomView).cap.maxPerHour).toBe(5);
    expect(await as(w, c.manager)('PUT', path(), { maxPerHour: 5 })).toMatchObject({ status: 200 });
    expect(
      (await auditTrail(w.t.db, 'flow', flow.id)).filter(
        ([action, field]) => action === 'update' && field === 'roomMaxPerHour',
      ),
    ).toEqual([['update', 'roomMaxPerHour', 30, 5]]);
    const tester = await as(w, c.tester)('PUT', path(), { maxPerHour: 9 });
    expect(tester.status).toBe(403);
    expect(errorCode(tester)).toBe('not_lead');
    for (const maxPerHour of [0, 201, 2.5])
      expect((await as(w, c.owner)('PUT', path(), { maxPerHour })).status).toBe(400);
    expect((await as(w, c.owner)('PUT', flowsPath(c, '/not-an-id/room'), { maxPerHour: 3 })).status).toBe(
      404,
    );
  });
});

describe('a team room’s pages', () => {
  it('gives the latest messages, oldest first, and the pages before them by their cursor', async () => {
    const c = await teamCompany(w);
    const body = {
      leadPrincipalId: c.manager.principalId,
      name: 'People',
      steps: [{ name: 'Do', kind: 'work', assigneePrincipalId: c.tester.principalId }],
    };
    const made = (await as(w, c.owner)('POST', flowsPath(c), body)).body as FlowView;
    const path = (rest = '') => flowsPath(c, `/${made.id}/room${rest}`);
    for (const n of [1, 2, 3, 4, 5]) {
      w.clock.advance(1000);
      expect((await as(w, c.tester)('POST', path('/messages'), { body: `Message ${n}` })).status).toBe(201);
    }
    const bodies = (room: RoomView) => room.messages.map((m) => m.body);
    const first = (await as(w, c.viewer)('GET', path('?limit=2'))).body as RoomView;
    expect(bodies(first)).toEqual(['Message 4', 'Message 5']);
    expect(first.members).toEqual({ agents: [], people: expect.any(Array) });
    const second = (await as(w, c.viewer)('GET', path(`?limit=2&before=${first.nextBefore}`)))
      .body as RoomView;
    expect(bodies(second)).toEqual(['Message 2', 'Message 3']);
    const last = (await as(w, c.viewer)('GET', path(`?limit=2&before=${second.nextBefore}`)))
      .body as RoomView;
    expect(bodies(last)).toEqual(['Message 1']);
    expect(last.nextBefore).toBeNull();
    const odd = (await as(w, c.viewer)('GET', path('?limit=2&before=nonsense'))).body as RoomView;
    expect(bodies(odd)).toEqual(['Message 4', 'Message 5']);
    expect((await as(w, c.viewer)('GET', path('?limit=0'))).status).toBe(400);
  });
});
