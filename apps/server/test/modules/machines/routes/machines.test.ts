import { apiKeys, machineSamples, machines, runnerSessions, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { RUNNER_CLOSE } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineStatsListView } from '../../../../src/modules/machines/schemas/stats.ts';
import type { MachineView } from '../../../../src/modules/machines/schemas.ts';
import { call } from '../../../fixtures/companies/companies.ts';
import {
  auditOf,
  DEVBOX,
  enroll,
  MAC,
  machineRow,
  machinesPath,
  sampleAt,
} from '../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
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

const MINUTE = 60_000;
const listed = (body: unknown) => (body as { machines: MachineView[] }).machines;

describe('GET /api/companies/:companyId/machines and /:machineId', () => {
  it('lists the machines by name and shows one, to viewers too', async () => {
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const mac = await enroll(w, company);
    const box = await enroll(w, company, DEVBOX);
    const res = await as(w, viewer)('GET', machinesPath(company));
    expect(res.status).toBe(200);
    expect(listed(res.body).map((machine) => machine.id)).toEqual([box.machineId, mac.machineId]);
    expect(await as(w, viewer)('GET', machinesPath(company, `/${mac.machineId}`))).toMatchObject({
      status: 200,
      body: {
        id: mac.machineId,
        name: 'This Mac',
        kind: 'laptop',
        provider: 'none',
        providerRef: null,
        controllerMachineId: null,
        os: 'darwin',
        arch: 'arm64',
        hostname: MAC.hostname,
        unixUser: 'ihor',
        versions: { runner: '0.5.0', claude: '2.1.3 (Claude Code)' },
        slots: 1,
        status: 'offline',
        lastSeenAt: null,
        hold: { until: null, source: null },
        hourlyCost: null,
        createdAt: expect.any(String),
      },
    });
  });

  it('is a 401 without a credential and a 404 for a non-member, another company or an unknown id', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const theirs = await enroll(w, other);
    expect((await call(w, undefined)('GET', machinesPath(company))).status).toBe(401);
    expect((await call(w, undefined)('GET', machinesPath(company, `/${theirs.machineId}`))).status).toBe(401);
    expect((await as(w, other.owner)('GET', machinesPath(company))).status).toBe(404);
    for (const id of [theirs.machineId, '019a5b2e-0000-7000-8000-000000000000', 'not-a-uuid']) {
      expect(await as(w, company.owner)('GET', machinesPath(company, `/${id}`))).toMatchObject({
        status: 404,
        body: { error: { code: 'machine_not_found' } },
      });
    }
    expect(listed((await as(w, company.owner)('GET', machinesPath(company))).body)).toEqual([]);
  });
});

describe('PATCH /api/companies/:companyId/machines/:machineId', () => {
  it('renames a machine for an admin, trimmed, and audits it', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const { machineId } = await enroll(w, company);
    const res = await as(w, admin, 'req-rename')('PATCH', machinesPath(company, `/${machineId}`), {
      name: '  Ihor’s Mac  ',
    });
    expect(res).toMatchObject({ status: 200, body: { id: machineId, name: 'Ihor’s Mac' } });
    expect(await auditOf(w.t.db, 'machine', machineId)).toContain('update name');
  });

  it('is refused without a credential, below admin, in another company, and for a bad name', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const { machineId } = await enroll(w, company);
    const path = machinesPath(company, `/${machineId}`);
    expect((await call(w, undefined)('PATCH', path, { name: 'x' })).status).toBe(401);
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect((await as(w, person)('PATCH', path, { name: 'x' })).status).toBe(403);
    }
    const theirs = await enroll(w, other);
    expect(
      (await as(w, company.owner)('PATCH', machinesPath(company, `/${theirs.machineId}`), { name: 'x' }))
        .status,
    ).toBe(404);
    expect((await as(w, other.owner)('PATCH', path, { name: 'x' })).status).toBe(404);
    for (const name of ['   ', 'x'.repeat(81)]) {
      expect((await as(w, company.owner)('PATCH', path, { name })).status).toBe(400);
    }
    expect((await machineRow(w.t.db, machineId))?.name).toBe('This Mac');
  });
});

describe('DELETE /api/companies/:companyId/machines/:machineId', () => {
  it('revokes its runner key, closes its socket (4001), takes it offline and from every list; audited', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    expect((await machineRow(w.t.db, machineId))?.status).toBe('online');
    const res = await as(w, admin)('DELETE', machinesPath(company, `/${machineId}`));
    expect(res).toMatchObject({ status: 204, body: null });
    expect((await runner.closed()).code).toBe(RUNNER_CLOSE.unauthorized);
    await w.hub.idle();
    expect(await machineRow(w.t.db, machineId)).toMatchObject({ status: 'offline', removedAt: w.clock() });
    const [key] = await rawDb(w.t.db).select().from(apiKeys).where(eq(apiKeys.machineId, machineId));
    expect(key?.revokedAt).toEqual(w.clock());
    expect(await auditOf(w.t.db, 'machine', machineId)).toContain('delete removedAt');
    expect(await auditOf(w.t.db, 'api_key', key?.id as string)).toContain('revoke revokedAt');
    await expect(runner.connect()).rejects.toThrow(/401/);
    expect(listed((await as(w, admin)('GET', machinesPath(company))).body)).toEqual([]);
    expect((await as(w, admin)('DELETE', machinesPath(company, `/${machineId}`))).status).toBe(404);
  });

  it('is refused without a credential, below admin and in another company', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const { machineId } = await enroll(w, company);
    const path = machinesPath(company, `/${machineId}`);
    expect((await call(w, undefined)('DELETE', path)).status).toBe(401);
    const member = await addMember(w, company, 'member');
    expect((await as(w, member)('DELETE', path)).status).toBe(403);
    expect((await as(w, other.owner)('DELETE', path)).status).toBe(404);
    expect((await as(w, other.owner)('DELETE', machinesPath(other, `/${machineId}`))).status).toBe(404);
    expect((await machineRow(w.t.db, machineId))?.removedAt).toBeNull();
  });
});

describe('GET /api/companies/:companyId/machines/stats', () => {
  it("gives every machine's board row: now, uptime, runtime, the sparkline, up/down and overload", async () => {
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const busy = await enroll(w, company, { name: 'Busy' });
    const quiet = await enroll(w, company, { name: 'Quiet' });
    const now = Date.parse(TEST_NOW);
    const t = await tenant(w.t.db, company.companyId);
    await t.insert(runnerSessions, [
      { machineId: busy.machineId, version: '0.5.0', connectedAt: new Date(now - 30 * MINUTE) },
      {
        machineId: quiet.machineId,
        version: '0.5.0',
        connectedAt: new Date(now - 3 * 60 * MINUTE),
        disconnectedAt: new Date(now - 2 * 60 * MINUTE),
      },
    ]);
    const { at: _at, ...hot } = sampleAt(0, { load1: 12, cpus: 8, cpuPct: 95 });
    await t.insert(machineSamples, [
      { machineId: busy.machineId, at: new Date(now - MINUTE), ...hot },
      { machineId: busy.machineId, at: new Date(now - 2 * MINUTE), ...hot },
    ]);
    await t.update(
      machines,
      { status: 'online', lastSeenAt: new Date(now) },
      eq(machines.id, busy.machineId),
    );
    const res = await as(w, viewer)('GET', machinesPath(company, '/stats'));
    expect(res.status).toBe(200);
    const body = res.body as MachineStatsListView;
    expect(body.at).toBe(TEST_NOW);
    const [first, second] = body.machines;
    expect(first).toMatchObject({
      machineId: busy.machineId,
      name: 'Busy',
      status: 'online',
      now: { at: new Date(now - MINUTE).toISOString(), load1: 12, cpus: 8, loadPerCpu: 1.5, cpuPct: 95 },
      upSince: new Date(now - 30 * MINUTE).toISOString(),
      runtime: { h24Ms: 30 * MINUTE, d7Ms: 30 * MINUTE },
      agentRuns24hMs: null,
      overloaded: { now: true, share24h: 1, badge: true },
    });
    expect(first?.series).toHaveLength(288);
    expect(first?.series.at(-1)).toEqual({ at: TEST_NOW, loadPerCpu: null });
    expect(first?.series.at(-2)?.loadPerCpu).toBe(1.5);
    expect(first?.upDown.h24.at(-1)).toEqual({
      from: new Date(now - 30 * MINUTE).toISOString(),
      to: TEST_NOW,
      up: true,
    });
    expect(second).toMatchObject({
      machineId: quiet.machineId,
      status: 'offline',
      now: null,
      upSince: null,
      runtime: { h24Ms: 60 * MINUTE, d7Ms: 60 * MINUTE },
      overloaded: { now: false, share24h: 0, badge: false },
    });
    expect(second?.upDown.h24.map((segment) => segment.up)).toEqual([false, true, false]);
  });

  it('is a 401 without a credential and a 404 for a non-member', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    expect((await call(w, undefined)('GET', machinesPath(company, '/stats'))).status).toBe(401);
    expect((await as(w, other.owner)('GET', machinesPath(company, '/stats'))).status).toBe(404);
  });
});
