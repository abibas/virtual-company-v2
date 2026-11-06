import type { StoredMembership } from '@mwc/identity-core';
import { seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbIdentityStore } from '../../../../../src/modules/identity/repo.ts';
import { call, joinCompany } from '../../../../fixtures/companies/companies.ts';
import { deliverEvents } from '../../../../fixtures/identity/webhooks.ts';
import { as, type MembersCompany, memberPath, membersCompany } from '../../../../fixtures/members/members.ts';
import {
  agentProfileOf,
  fieldAudit,
  LEARNING_PATHS,
  learnBy,
  managerWithReports,
  seedProfile,
  testChart,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// A person who leaves a company, by any path S2.4's lifecycle covers, takes their access profiles off its agents in
// the same transaction (S3.4): their personal subscriptions stop powering a company they left. Other people's profiles
// on its agents, and their own on agents of the companies they stay in, are left as they are.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/**
 * An admin who joined `company` through the provider, with two of their profiles on its agents (one archived), the
 * owner's profile on another of its agents, and one of theirs on an agent of a company they stay in.
 */
async function leaverWithProfiles(company: MembersCompany) {
  const team = await managerWithReports(w, company, company.owner);
  const db = w.t.db;
  const owner = company.owner.principalId;
  const [mine, archivedOne, owners] = [
    await seedProfile(db, team.member.userId),
    await seedProfile(db, team.member.userId),
    await seedProfile(db, company.owner.userId),
  ];
  const agent = (await seedAgent(db, company.companyId, { reportsTo: owner, profileId: mine.id })).agent;
  const archived = (
    await seedAgent(db, company.companyId, {
      reportsTo: owner,
      profileId: archivedOne.id,
      status: 'archived',
    })
  ).agent;
  const kept = (await seedAgent(db, company.companyId, { reportsTo: owner, profileId: owners.id })).agent;
  const elsewhere = await membersCompany(w);
  await joinCompany(db, elsewhere.companyId, team.member.userId, 'admin');
  const away = (
    await seedAgent(db, elsewhere.companyId, { reportsTo: elsewhere.owner.principalId, profileId: mine.id })
  ).agent;
  return { team, mine, archivedOne, owners, agent, archived, kept, away };
}

type World = Awaited<ReturnType<typeof leaverWithProfiles>>;

/**
 * The leaver's profiles are off the company's agents, audited by `by`; everyone else's stay, and so do theirs in the
 * company they stay in (unless they left it too).
 */
async function expectCleared(
  company: MembersCompany,
  world: World,
  audit: { readonly by: string; readonly requestId: unknown; readonly leftEverywhere?: boolean },
) {
  const { by, requestId } = audit;
  const db = w.t.db;
  expect(await agentProfileOf(db, world.agent.id)).toBeNull();
  expect(await agentProfileOf(db, world.archived.id)).toBeNull();
  expect(await agentProfileOf(db, world.kept.id)).toBe(world.owners.id);
  expect(await agentProfileOf(db, world.away.id)).toBe(audit.leftEverywhere ? null : world.mine.id);
  expect(await fieldAudit(db, 'agent', world.agent.id, 'profileId')).toEqual([
    [company.companyId, 'update', by, requestId, world.mine.id, null],
  ]);
  expect(await fieldAudit(db, 'agent', world.archived.id, 'profileId')).toEqual([
    [company.companyId, 'update', by, requestId, world.archivedOne.id, null],
  ]);
  expect(await fieldAudit(db, 'agent', world.kept.id, 'profileId')).toEqual([]);
}

describe.each(LEARNING_PATHS)('a membership removed at the provider, learned by %s', (path) => {
  it('takes the person’s profiles off the company’s agents', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    w.fake.drainEvents();
    await w.fake.removeMember(company.orgId as string, world.team.joiner.subject);
    const events = w.fake.drainEvents();
    const subject = world.team.joiner.subject;
    const requestId = await learnBy(w, company, path, { subject, events, label: 'profiles-leave' });
    await expectCleared(company, world, { by: 'system', requestId });
  });
});

describe('a membership that ends through the API or otherwise', () => {
  it('takes them off when an owner removes the person, audited by the owner', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    const removed = await as(
      w,
      company.owner,
      'req-profiles-remove',
    )('DELETE', memberPath(company, world.team.member.id));
    expect(removed.status).toBe(204);
    await expectCleared(company, world, { by: company.owner.principalId, requestId: 'req-profiles-remove' });
  });

  it('takes them off when the person leaves by themselves, audited by them', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    const leave = call(w, `fake:${world.team.joiner.subject}`, 'req-profiles-self');
    expect((await leave('DELETE', memberPath(company, world.team.member.id))).status).toBe(204);
    await expectCleared(company, world, {
      by: world.team.member.principalId,
      requestId: 'req-profiles-self',
    });
  });

  it('takes them off every company’s agents when the person is deleted at the provider', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    w.fake.drainEvents();
    w.fake.deleteUser(world.team.joiner.subject);
    expect(new Set(await deliverEvents(w, w.fake.drainEvents()))).toEqual(new Set(['processed']));
    // Deleted at the provider, they leave every company: the one they stayed in too.
    await expectCleared(company, world, {
      by: 'system',
      requestId: expect.any(String),
      leftEverywhere: true,
    });
  });

  it('takes them off when the membership is suspended, and does not put them back on re-activation', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    const store = (requestId: string) =>
      dbIdentityStore(w.t.db, { provider: 'fake', chart: testChart(), requestId });
    const { id: _id, ...membership } = (await store('x').getMembership(
      company.companyId,
      world.team.member.userId,
    )) as StoredMembership;
    await store('req-profiles-suspend').upsertMembership({ ...membership, status: 'suspended' });
    await expectCleared(company, world, { by: 'system', requestId: 'req-profiles-suspend' });
    await store('req-profiles-back').upsertMembership({ ...membership, status: 'active' });
    expect(await agentProfileOf(w.t.db, world.agent.id)).toBeNull();
  });

  it('changes nothing on a role change', async () => {
    const company = await membersCompany(w);
    const world = await leaverWithProfiles(company);
    const res = await as(w, company.owner)('PATCH', memberPath(company, world.team.member.id), {
      role: 'member',
    });
    expect(res.status).toBe(200);
    expect(await agentProfileOf(w.t.db, world.agent.id)).toBe(world.mine.id);
  });
});
