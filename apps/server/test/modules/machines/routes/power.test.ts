import { DEFAULT_MACHINE_POWER_POLICY } from '@mwc/shared/machines';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachinePowerView, PowerEventView } from '../../../../src/modules/machines/schemas/power.ts';
import { call } from '../../../fixtures/companies/companies.ts';
import { enroll, machinesPath } from '../../../fixtures/machines/machines.ts';
import { eventsOf, macAndBox, powerPath, powerRow, putPolicy } from '../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

// Friday 2026-11-06 12:00Z is 14:00 in Kyiv, inside Mon–Fri 09:00–19:00 (07:00Z–17:00Z).
const FRIDAY_NOON = '2026-11-06T12:00:00.000Z';
const KEEP_ON = { keepOn: { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00' } };
const NO_STATE = {
  holdUntil: null,
  holdReason: null,
  autoStartedWindow: null,
  manualStopAt: null,
  lastTurnAt: null,
};
const viewOf = (body: unknown) => body as MachinePowerView;
const eventsBody = (body: unknown) => (body as { events: PowerEventView[] }).events;

describe('GET /api/companies/:companyId/machines/:machineId/power', () => {
  it("shows a machine's default power to viewers, and a devbox's box as not read yet", async () => {
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const { mac, box } = await macAndBox(w, company);
    expect(await as(w, viewer)('GET', powerPath(company, mac.machineId))).toMatchObject({
      status: 200,
      body: {
        policy: DEFAULT_MACHINE_POWER_POLICY,
        state: NO_STATE,
        box: null,
        controller: null,
        canControl: false,
      },
    });
    const res = await as(w, company.owner)('GET', powerPath(company, box.machineId));
    expect(res).toMatchObject({ status: 200, body: { canControl: true, controller: null } });
    expect(viewOf(res.body).box).toEqual({
      status: 'unknown',
      size: null,
      hourlyCost: null,
      rules: null,
      checkedAt: null,
      error: null,
    });
    expect(await powerRow(w.t.db, box.machineId)).toBeUndefined();
  });

  it('is a 401 without a credential and a 404 for another company, an unknown or a removed machine', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const theirs = await enroll(w, other);
    const mine = await enroll(w, company);
    expect((await call(w, undefined)('GET', powerPath(company, mine.machineId))).status).toBe(401);
    expect((await as(w, other.owner)('GET', powerPath(company, mine.machineId))).status).toBe(404);
    await as(w, company.owner)('DELETE', machinesPath(company, `/${mine.machineId}`));
    for (const id of [theirs.machineId, mine.machineId, 'not-a-uuid']) {
      expect(await as(w, company.owner)('GET', powerPath(company, id))).toMatchObject({
        status: 404,
        body: { error: { code: 'machine_not_found' } },
      });
    }
  });
});

describe('PUT /api/companies/:companyId/machines/:machineId/power', () => {
  it('saves the policy for an admin, logs it in words, and holds the machine at once', async () => {
    w.clock.set(FRIDAY_NOON);
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const { mac } = await macAndBox(w, company);
    const runner = await w.connect(mac.runnerKey);
    expect((await runner.frames.next('machine.hold')).until).toBeNull();
    const res = await as(w, admin)('PUT', powerPath(company, mac.machineId), KEEP_ON);
    expect(res.status).toBe(200);
    expect(viewOf(res.body)).toMatchObject({
      policy: {
        ...DEFAULT_MACHINE_POWER_POLICY,
        keepOn: { ...DEFAULT_MACHINE_POWER_POLICY.keepOn, enabled: true },
      },
      state: {
        holdUntil: '2026-11-06T17:00:00.000Z',
        holdReason: 'Held for the keep-on hours, until 19:00 (Europe/Kyiv)',
      },
    });
    expect((await runner.frames.next('machine.hold')).until).toBe(Date.parse('2026-11-06T17:00:00Z'));
    expect(await eventsOf(w.t.db, mac.machineId)).toEqual([
      `policy user:${admin.userId}: Keep-on hours on (Mon–Fri 09:00–19:00 Europe/Kyiv); start when they begin: off; ` +
        'stop when they end: on; hold after a turn: 45 min; keep This Mac awake: on; start on work: off; ' +
        'start on a message: off',
      'held schedule: Held for the keep-on hours, until 19:00 (Europe/Kyiv)',
    ]);
    expect((await powerRow(w.t.db, mac.machineId))?.updatedBy).toBe(admin.principalId);
    // Off again: the hold is released and the runner told.
    await putPolicy(w, company, mac.machineId, {});
    expect((await runner.frames.next('machine.hold')).until).toBeNull();
    expect((await eventsOf(w.t.db, mac.machineId)).at(-1)).toBe(
      'released schedule: Released: outside the keep-on hours',
    );
  });

  it('is refused without a credential, below admin, in another company, and for a policy that does not parse', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const { mac } = await macAndBox(w, company);
    const path = powerPath(company, mac.machineId);
    expect((await call(w, undefined)('PUT', path, {})).status).toBe(401);
    for (const role of ['member', 'viewer'] as const) {
      expect((await as(w, await addMember(w, company, role))('PUT', path, {})).status).toBe(403);
    }
    expect((await as(w, other.owner)('PUT', path, {})).status).toBe(404);
    const theirs = await enroll(w, other);
    expect((await as(w, company.owner)('PUT', powerPath(company, theirs.machineId), {})).status).toBe(404);
    for (const policy of [
      { keepOn: { from: '09:00', to: '09:00' } },
      { keepOn: { timezone: 'Mars/Olympus' } },
      { keepOn: { days: [] } },
      { holdAfterTurnMin: 721 },
    ]) {
      expect(await as(w, company.owner)('PUT', path, policy)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(await powerRow(w.t.db, mac.machineId)).toBeUndefined();
  });
});

describe('GET /api/companies/:companyId/machines/:machineId/events', () => {
  it('lists the newest first, 10 unless asked, naming people and not the schedule', async () => {
    w.clock.set(FRIDAY_NOON);
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const { mac } = await macAndBox(w, company);
    for (let i = 0; i < 6; i++) {
      await putPolicy(w, company, mac.machineId, i % 2 === 0 ? KEEP_ON : {});
      w.clock.advance(1000);
    }
    const res = await as(w, viewer)('GET', machinesPath(company, `/${mac.machineId}/events`));
    expect(res.status).toBe(200);
    const events = eventsBody(res.body);
    expect(events).toHaveLength(10);
    expect(events.map((event) => event.action).slice(0, 4)).toEqual(['released', 'policy', 'held', 'policy']);
    expect(events[1]).toMatchObject({
      actor: `user:${company.owner.userId}`,
      actorName: `Owner ${company.owner.subject}`,
      at: '2026-11-06T12:00:05.000Z',
      id: expect.any(String),
    });
    expect(events[0]).toMatchObject({ actor: 'schedule', actorName: null });
    const few = await as(w, viewer)('GET', machinesPath(company, `/${mac.machineId}/events?limit=3`));
    expect(eventsBody(few.body)).toEqual(events.slice(0, 3));
    const all = await as(w, viewer)('GET', machinesPath(company, `/${mac.machineId}/events?limit=100`));
    expect(eventsBody(all.body)).toHaveLength(12);
  });

  it('is refused for a bad limit, without a credential, and for another company', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const { mac } = await macAndBox(w, company);
    const path = machinesPath(company, `/${mac.machineId}/events`);
    for (const limit of ['0', '101', 'ten']) {
      expect((await as(w, company.owner)('GET', `${path}?limit=${limit}`)).status).toBe(400);
    }
    expect((await call(w, undefined)('GET', path)).status).toBe(401);
    expect((await as(w, other.owner)('GET', path)).status).toBe(404);
    const theirs = await enroll(w, other);
    expect(
      (await as(w, company.owner)('GET', machinesPath(company, `/${theirs.machineId}/events`))).status,
    ).toBe(404);
    expect(eventsBody((await as(w, company.owner)('GET', path)).body)).toEqual([]);
  });
});

describe('the power API in the OpenAPI document', () => {
  it('lists every power route with its statuses', async () => {
    const doc = (await (await w.t.app.request('/api/openapi.json')).json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const statuses = (path: string, method: string) =>
      Object.keys(
        doc.paths[`/api/companies/{companyId}/machines/{machineId}${path}`]?.[method]?.responses ?? {},
      );
    expect(statuses('/power', 'get')).toEqual(['200', '401', '404']);
    expect(statuses('/power', 'put')).toEqual(['200', '400', '401', '403', '404']);
    for (const action of ['/power/start', '/power/stop']) {
      expect(statuses(action, 'post')).toEqual(['202', '401', '403', '404', '409', '422', '502']);
    }
    expect(statuses('/power/timezone', 'post')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '502',
    ]);
    expect(statuses('/events', 'get')).toEqual(['200', '400', '401', '404']);
    expect(statuses('', 'patch')).toEqual(['200', '400', '401', '403', '404', '422']);
  });
});

describe('the hold on connect', () => {
  it("sends a runner that connects its machine's hold, every time", async () => {
    w.clock.set(FRIDAY_NOON);
    const company = await membersCompany(w);
    const { mac } = await macAndBox(w, company);
    await putPolicy(w, company, mac.machineId, KEEP_ON);
    const runner = await w.connect(mac.runnerKey);
    expect((await runner.frames.next('machine.hold')).until).toBe(Date.parse('2026-11-06T17:00:00Z'));
    w.clock.set('2026-11-06T18:00:00Z');
    await runner.reconnect();
    expect((await runner.frames.next('machine.hold')).until).toBeNull();
    await eventually('the release is logged', async () =>
      (await eventsOf(w.t.db, mac.machineId)).some((event) => event.startsWith('released')),
    );
  });
});
