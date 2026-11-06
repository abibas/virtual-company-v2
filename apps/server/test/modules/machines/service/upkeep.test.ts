import { companies, machineSamples, machines, runnerSessions, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { machineUpkeep } from '../../../../src/modules/machines/index.ts';
import { MACHINE_LEASE_MS, PRUNE_INTERVAL_MS } from '../../../../src/modules/machines/rules.ts';
import { lapsed } from '../../../../src/modules/machines/service/presence.ts';
import { enroll, machineRow, sampleAt, samplesOf, sessionsOf } from '../../../fixtures/machines/machines.ts';
import { type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
let company: MembersCompany;
beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
});
afterAll(() => w.t.close());

const NOW = Date.parse(TEST_NOW);
const DAY = 24 * 60 * 60_000;

/** A machine of `owner` marked online, last seen `agoMs` before now, with a session open since an hour before. */
async function onlineMachine(owner: MembersCompany, agoMs: number): Promise<string> {
  const { machineId } = await enroll(w, owner);
  const t = await tenant(w.t.db, owner.companyId);
  await t.update(
    machines,
    { status: 'online', lastSeenAt: new Date(NOW - agoMs) },
    eq(machines.id, machineId),
  );
  await t.insert(runnerSessions, { machineId, version: '0.5.0', connectedAt: new Date(NOW - 60 * 60_000) });
  return machineId;
}

describe('the offline sweep', () => {
  it('takes offline a machine whose lease lapsed, ending its session at its last sign of life; fresh ones stay', async () => {
    const stale = await onlineMachine(company, MACHINE_LEASE_MS + 1_000);
    const fresh = await onlineMachine(company, MACHINE_LEASE_MS - 1_000);
    const deleted = await membersCompany(w);
    const orphan = await onlineMachine(deleted, 10 * MACHINE_LEASE_MS);
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, deleted.companyId));
    const upkeep = machineUpkeep({ db: w.t.db, clock: w.clock });
    expect((await upkeep()).offline).toBe(1);
    expect((await machineRow(w.t.db, stale))?.status).toBe('offline');
    expect((await sessionsOf(w.t.db, stale))[0]?.disconnectedAt).toEqual(
      new Date(NOW - MACHINE_LEASE_MS - 1_000),
    );
    expect((await machineRow(w.t.db, fresh))?.status).toBe('online');
    expect((await sessionsOf(w.t.db, fresh))[0]?.disconnectedAt).toBeNull();
    expect((await machineRow(w.t.db, orphan))?.status).toBe('online');
    expect((await upkeep()).offline).toBe(0);
  });

  it('leaves a machine whose runner spoke in the meantime, and a removed one', async () => {
    const machineId = await onlineMachine(company, 0);
    const t = await tenant(w.t.db, company.companyId);
    const cutoff = new Date(NOW - MACHINE_LEASE_MS);
    expect(await lapsed(t, machineId, cutoff)).toBe(false);
    await t.update(machines, { removedAt: new Date(NOW) }, eq(machines.id, machineId));
    expect(await lapsed(t, machineId, new Date(NOW + DAY))).toBe(false);
  });
});

describe('the prune', () => {
  it('deletes samples older than 7 days, at most once an hour', async () => {
    const { machineId } = await enroll(w, company);
    const t = await tenant(w.t.db, company.companyId);
    const row = (at: number) => {
      const { at: _taken, ...sample } = sampleAt(at);
      return { machineId, at: new Date(at), ...sample };
    };
    await t.insert(machineSamples, [row(NOW - 8 * DAY), row(NOW - 7 * DAY + 60_000), row(NOW - 60_000)]);
    const upkeep = machineUpkeep({ db: w.t.db, clock: w.clock });
    expect((await upkeep()).pruned).toBe(1);
    expect((await samplesOf(w.t.db, machineId)).map((sample) => sample.at.getTime())).toEqual([
      NOW - 7 * DAY + 60_000,
      NOW - 60_000,
    ]);
    w.clock.advance(PRUNE_INTERVAL_MS - 1);
    expect((await upkeep()).pruned).toBeNull();
    w.clock.advance(1);
    expect((await upkeep()).pruned).toBe(1);
    expect(await samplesOf(w.t.db, machineId)).toHaveLength(1);
    w.clock.set(TEST_NOW);
  });
});
