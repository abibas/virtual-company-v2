import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import {
  type FlowView,
  flowsPath,
  makeFlow,
  type TeamCompany,
  teamCompany,
} from '../../../fixtures/tasks.ts';

/**
 * `GET|PUT …/flows/{flowId}/lead-wakes` (S6c): anyone of the company reads a flow's Lead wake-up settings and how its
 * wake-ups went; the team's Lead people and admins change them, audited on the flow; the bounds are the schema's.
 */

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const errorCode = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;

const SETTINGS = {
  escalated: true,
  blocked: false,
  turnEnded: true,
  done: true,
  signoffHours: 24,
  windowSeconds: 120,
  maxPerHour: 3,
  maxPerDay: 20,
  checkInMinutes: 10,
};

describe('a flow’s Lead wake-ups', () => {
  let c: TeamCompany;
  let flow: FlowView;
  const path = () => flowsPath(c, `/${flow.id}/lead-wakes`);
  beforeAll(async () => {
    c = await teamCompany(w);
    flow = await makeFlow(w, c);
  });

  it('shows the defaults to anyone of the company, before any wake-up', async () => {
    const res = await as(w, c.viewer)('GET', path());
    expect(res).toMatchObject({ status: 200 });
    expect(res.body).toEqual({
      escalated: true,
      blocked: true,
      turnEnded: true,
      done: false,
      signoffHours: null,
      windowSeconds: 60,
      maxPerHour: 12,
      maxPerDay: 150,
      checkInMinutes: 5,
      leadIsAgent: true,
      chat: null,
      last: null,
      counts: { hour: 0, day: 0, pending: 0 },
    });
  });

  it('lets the Lead’s people and admins change them, audited, and nobody else', async () => {
    expect(errorCode(await as(w, c.member)('PUT', path(), SETTINGS))).toBe('not_lead');
    expect((await as(w, c.viewer)('PUT', path(), SETTINGS)).status).toBe(403);
    const res = await as(w, c.manager)('PUT', path(), SETTINGS);
    expect(res).toMatchObject({ status: 200, body: { ...SETTINGS, leadIsAgent: true } });
    expect((await as(w, c.admin)('PUT', path(), SETTINGS)).status).toBe(200);
    const updates = (await auditTrail(w.t.db, 'flow', flow.id)).filter(([action]) => action === 'update');
    expect(updates).toEqual(
      expect.arrayContaining([
        ['update', 'wakeBlocked', true, false],
        ['update', 'wakeDone', false, true],
        ['update', 'wakeSignoffHours', null, 24],
        ['update', 'wakeWindowSeconds', 60, 120],
        ['update', 'wakeMaxPerHour', 12, 3],
        ['update', 'wakeMaxPerDay', 150, 20],
        ['update', 'wakeCheckInMinutes', 5, 10],
      ]),
    );
    expect(updates).toHaveLength(7);
    expect((await as(w, c.viewer)('GET', path())).body).toMatchObject(SETTINGS);
  });

  it('refuses settings out of bounds, and another company’s or no flow', async () => {
    for (const bad of [
      { windowSeconds: 601 },
      { maxPerHour: 0 },
      { maxPerDay: 501 },
      { signoffHours: 0 },
      { checkInMinutes: 2 },
      { checkInMinutes: 61 },
      { done: 'yes' },
    ]) {
      expect((await as(w, c.owner)('PUT', path(), { ...SETTINGS, ...bad })).status).toBe(400);
    }
    expect((await as(w, c.owner)('PUT', path(), { escalated: true })).status).toBe(400);
    expect((await as(w, c.owner)('PUT', path(), { ...SETTINGS, checkInMinutes: null })).body).toMatchObject({
      checkInMinutes: null,
    });
    const other = await teamCompany(w);
    const theirs = await makeFlow(w, other);
    expect((await as(w, c.owner)('GET', flowsPath(c, `/${theirs.id}/lead-wakes`))).status).toBe(404);
    expect((await as(w, c.owner)('PUT', flowsPath(c, `/${theirs.id}/lead-wakes`), SETTINGS)).status).toBe(
      404,
    );
    expect(errorCode(await as(w, c.owner)('GET', flowsPath(c, '/not-an-id/lead-wakes')))).toBe(
      'flow_not_found',
    );
  });

  it('says a person Lead does not wake up', async () => {
    const body = {
      leadPrincipalId: c.manager.principalId,
      name: 'People',
      steps: [{ name: 'Do', kind: 'work', assigneePrincipalId: c.tester.principalId }],
    };
    const made = await as(w, c.owner)('POST', flowsPath(c), body);
    const res = await as(w, c.owner)('GET', flowsPath(c, `/${(made.body as FlowView).id}/lead-wakes`));
    expect(res.body).toMatchObject({ leadIsAgent: false });
  });
});
