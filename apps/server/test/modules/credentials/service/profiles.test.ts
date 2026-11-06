import { seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../src/modules/credentials/schemas/profiles.ts';
import { addUser, call, companyRow, joinCompany } from '../../../fixtures/companies/companies.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import {
  agentProfileOf,
  defaultProfileOf,
  fieldAudit,
  PROFILES,
  putDefault,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

// What an access profile's owner sees of its use and what removing it does (S3.4): the agents using it in their
// companies, and, on removal, the agents and defaults it leaves, detached by the foreign keys with audit rows in each
// company, by the owner.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** A company owned by the profiles' owner, and a second company they joined as an admin. */
async function twoCompanies() {
  const home = await membersCompany(w);
  const second = await membersCompany(w);
  const { principalId } = await joinCompany(w.t.db, second.companyId, home.owner.userId, 'admin');
  return { home, second, ownerInSecond: principalId };
}

const listOf = async (who: Parameters<typeof as>[1]) =>
  ((await as(w, who)('GET', PROFILES)).body as { profiles: AccessProfileView[] }).profiles;

describe('the agents using a profile', () => {
  it('are listed per profile with their company, across the owner’s companies, archived ones too', async () => {
    const { home, second } = await twoCompanies();
    const owner = home.owner;
    const used = await seedProfile(w.t.db, owner.userId, { name: 'Used' });
    const idle = await seedProfile(w.t.db, owner.userId, { name: 'Idle' });
    const a = await seedAgent(w.t.db, home.companyId, {
      reportsTo: owner.principalId,
      profileId: used.id,
      name: 'Here',
      slug: 'here',
    });
    const archived = await seedAgent(w.t.db, home.companyId, {
      reportsTo: null,
      profileId: used.id,
      status: 'archived',
      name: 'Asleep',
      slug: 'asleep',
    });
    const b = await seedAgent(w.t.db, second.companyId, {
      reportsTo: second.owner.principalId,
      profileId: used.id,
      name: 'There',
      slug: 'there',
    });
    const profiles = await listOf(owner);
    expect(profiles.find((profile) => profile.id === idle.id)?.agents).toEqual([]);
    const agents = profiles.find((profile) => profile.id === used.id)?.agents ?? [];
    const of = (
      company: { companyId: string },
      agent: { agent: { id: string; name: string; slug: string } },
    ) =>
      expect.objectContaining({
        companyId: company.companyId,
        agentId: agent.agent.id,
        agentName: agent.agent.name,
        agentSlug: agent.agent.slug,
      });
    expect(agents).toHaveLength(3);
    expect(agents).toEqual(expect.arrayContaining([of(home, a), of(home, archived), of(second, b)]));
    const row = await companyRow(w.t.db, second.companyId);
    expect(agents.find((agent) => agent.agentId === b.agent.id)).toMatchObject({
      companySlug: row?.slug,
      companyName: row?.name,
    });
  });

  it('lists nothing for a person in no company', async () => {
    const loner = await addUser(w.t.db, w.fake);
    const profile = await seedProfile(w.t.db, loner.userId);
    const res = await call(w, loner.token)('GET', PROFILES);
    expect((res.body as { profiles: AccessProfileView[] }).profiles).toMatchObject([
      { id: profile.id, agents: [] },
    ]);
  });
});

describe('removing a profile', () => {
  it('takes it off its agents and the owner’s defaults, with audit rows in each company by the owner', async () => {
    const { home, second, ownerInSecond } = await twoCompanies();
    const owner = home.owner;
    const gone = await seedProfile(w.t.db, owner.userId);
    const stays = await seedProfile(w.t.db, owner.userId);
    const here = (
      await seedAgent(w.t.db, home.companyId, { reportsTo: owner.principalId, profileId: gone.id })
    ).agent;
    const there = (
      await seedAgent(w.t.db, second.companyId, { reportsTo: second.owner.principalId, profileId: gone.id })
    ).agent;
    const other = (
      await seedAgent(w.t.db, home.companyId, { reportsTo: owner.principalId, profileId: stays.id })
    ).agent;
    await putDefault(w.t.db, owner.membershipId, gone.id);
    const res = await as(w, owner, 'req-profile-gone')('DELETE', `${PROFILES}/${gone.id}`);
    expect(res.status).toBe(204);
    expect(await agentProfileOf(w.t.db, here.id)).toBeNull();
    expect(await agentProfileOf(w.t.db, there.id)).toBeNull();
    expect(await agentProfileOf(w.t.db, other.id)).toBe(stays.id);
    expect(await defaultProfileOf(w.t.db, owner.membershipId)).toBeNull();
    expect(await fieldAudit(w.t.db, 'agent', here.id, 'profileId')).toEqual([
      [home.companyId, 'update', owner.principalId, 'req-profile-gone', gone.id, null],
    ]);
    expect(await fieldAudit(w.t.db, 'agent', there.id, 'profileId')).toEqual([
      [second.companyId, 'update', ownerInSecond, 'req-profile-gone', gone.id, null],
    ]);
    expect(await fieldAudit(w.t.db, 'membership', owner.membershipId, 'defaultProfileId')).toEqual([
      [home.companyId, 'update', owner.principalId, 'req-profile-gone', gone.id, null],
    ]);
    expect(await fieldAudit(w.t.db, 'agent', other.id, 'profileId')).toEqual([]);
    expect((await listOf(owner)).map((profile) => profile.id)).toEqual([stays.id]);
  });
});
