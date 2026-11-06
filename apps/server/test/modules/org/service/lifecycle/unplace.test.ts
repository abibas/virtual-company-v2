import type { StoredMembership } from '@mwc/identity-core';
import { LEVEL, seedAgent } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbIdentityStore } from '../../../../../src/modules/identity/repo.ts';
import { deliverEvents } from '../../../../fixtures/identity/webhooks.ts';
import {
  activeOwners,
  as,
  memberPath,
  membersCompany,
  membershipRow,
} from '../../../../fixtures/members/members.ts';
import {
  LEARNING_PATHS,
  learnBy,
  managersOf,
  managerWithReports,
  orgCompany,
  placedMember,
  placeOf,
  positionAudit,
  testChart,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// A membership that ends (removed here or at the provider, or suspended) takes its person off the org chart (S2.4):
// their direct reports move up with `reparentOnRemoval` and their position goes, in the same transaction as the status
// change. Role changes and a company's soft delete move nobody.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** Writes a membership's status through the database identity store, as the projector does. */
async function setStatus(
  companyId: string,
  userId: string,
  status: StoredMembership['status'],
  requestId: string,
) {
  const store = dbIdentityStore(w.t.db, { provider: 'fake', chart: testChart(), requestId });
  const { id: _id, ...membership } = (await store.getMembership(companyId, userId)) as StoredMembership;
  return store.upsertMembership({ ...membership, status });
}

describe.each(LEARNING_PATHS)('a membership removed at the provider, learned by %s', (path) => {
  it('moves the person’s people and agents up to their manager and takes them off the chart', async () => {
    const company = await membersCompany(w);
    const team = await managerWithReports(w, company, company.owner);
    w.fake.drainEvents();
    await w.fake.removeMember(company.orgId as string, team.joiner.subject);
    const events = w.fake.drainEvents();
    const requestId = await learnBy(w, company, path, {
      subject: team.joiner.subject,
      events,
      label: 'leave',
    });
    expect(await membershipRow(w.t.db, team.member.id)).toMatchObject({ status: 'removed' });
    const owner = company.owner.principalId;
    const leaver = team.member.principalId;
    expect(
      await managersOf(w, company, [leaver, team.report.principalId, team.agent, team.subAgent]),
    ).toEqual([undefined, owner, owner, team.agent]);
    expect(await positionAudit(w, team.agent)).toEqual([['update', 'system', requestId, leaver, owner]]);
    expect((await positionAudit(w, leaver)).at(-1)).toEqual(['delete', 'system', requestId, owner, null]);
  });
});

describe('removing a member through the API', () => {
  it('moves a middle manager’s people and agents up to their manager, audited by whoever removed them', async () => {
    const company = await orgCompany(w);
    const owner = company.owner.principalId;
    const manager = company.admin.principalId;
    const report = await placedMember(w, company, 'member', { reportsTo: manager });
    const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: manager })).principal.id;
    const subAgent = (await seedAgent(w.t.db, company.companyId, { reportsTo: agent })).principal.id;
    const res = await as(w, company.owner, 'req-remove')('DELETE', memberPath(company, company.admin));
    expect(res.status).toBe(204);
    expect(await managersOf(w, company, [manager, report.principalId, agent, subAgent])).toEqual([
      undefined,
      owner,
      owner,
      agent,
    ]);
    const moved = [['update', owner, 'req-remove', manager, owner]];
    expect(await positionAudit(w, report.principalId)).toEqual(moved);
    expect(await positionAudit(w, agent)).toEqual(moved);
    expect(await positionAudit(w, manager)).toEqual([['delete', owner, 'req-remove', owner, null]]);
    // The last-owner guard kept an owner for the agents to fall back on.
    expect(await activeOwners(w.t.db, company.companyId)).toEqual([company.owner.membershipId]);
  });

  it('sends a removed root owner’s people to the top and their agents to the other owner', async () => {
    const company = await membersCompany(w);
    const first = company.owner.principalId;
    const second = await placedMember(w, company, 'owner');
    const report = await placedMember(w, company, 'member');
    const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: first })).principal.id;
    const res = await as(w, second, 'req-root')('DELETE', memberPath(company, company.owner));
    expect(res.status).toBe(204);
    const nodes = [first, second.principalId, report.principalId, agent];
    const asSecond = { ...company, owner: second };
    expect(await managersOf(w, asSecond, nodes)).toEqual([undefined, null, null, second.principalId]);
    expect(await positionAudit(w, agent)).toEqual([
      ['update', second.principalId, 'req-root', first, second.principalId],
    ]);
    // A place at the top is audited too.
    expect(await positionAudit(w, first)).toEqual([['delete', second.principalId, 'req-root', null, null]]);
  });

  it('refuses the last owner, whose place and agents stay as they are', async () => {
    const company = await membersCompany(w);
    const owner = company.owner.principalId;
    const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: owner })).principal.id;
    const res = await as(w, company.owner)('DELETE', memberPath(company, company.owner));
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'last_owner' } } });
    expect(await managersOf(w, company, [owner, agent])).toEqual([null, owner]);
    expect(await positionAudit(w, owner)).toEqual([]);
  });

  it('moves nobody on a role change', async () => {
    const company = await orgCompany(w);
    const res = await as(w, company.owner)('PATCH', memberPath(company, company.admin), { role: 'viewer' });
    expect(res).toMatchObject({ status: 200, body: { role: 'viewer' } });
    expect(await managersOf(w, company, [company.admin.principalId])).toEqual([company.owner.principalId]);
    expect(await positionAudit(w, company.admin.principalId)).toEqual([]);
  });
});

describe('a membership that ends otherwise', () => {
  it('takes a person deleted at the provider off the chart, their reports moved up', async () => {
    const company = await membersCompany(w);
    const team = await managerWithReports(w, company, company.owner);
    w.fake.drainEvents();
    w.fake.deleteUser(team.joiner.subject);
    expect(new Set(await deliverEvents(w, w.fake.drainEvents()))).toEqual(new Set(['processed']));
    expect(await membershipRow(w.t.db, team.member.id)).toMatchObject({ status: 'removed' });
    const owner = company.owner.principalId;
    expect(
      await managersOf(w, company, [team.member.principalId, team.report.principalId, team.agent]),
    ).toEqual([undefined, owner, owner]);
  });

  it('suspending moves the reports up; re-activating places the person under their inviter again', async () => {
    const company = await orgCompany(w);
    const admin = company.admin.principalId;
    const team = await managerWithReports(w, company, company.admin);
    const person = team.member.principalId;
    await setStatus(company.companyId, team.member.userId, 'suspended', 'req-suspend');
    expect(await managersOf(w, company, [person, team.report.principalId, team.agent])).toEqual([
      undefined,
      admin,
      admin,
    ]);
    expect(await positionAudit(w, team.agent)).toEqual([['update', 'system', 'req-suspend', person, admin]]);
    await setStatus(company.companyId, team.member.userId, 'active', 'req-back');
    expect(await managersOf(w, company, [person, team.report.principalId, team.agent])).toEqual([
      admin,
      admin,
      admin,
    ]);
    expect((await positionAudit(w, person)).slice(-2)).toEqual([
      ['delete', 'system', 'req-suspend', admin, null],
      ['create', 'system', 'req-back', null, admin],
    ]);
  });

  it('removes the only owner at the provider all the same, logging the agent it leaves at the top', async () => {
    const company = await membersCompany(w);
    expect((await as(w, company.owner)('POST', `/api/companies/${company.companyId}/sync`)).status).toBe(200);
    const owner = company.owner.principalId;
    const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: owner })).principal.id;
    w.fake.drainEvents();
    await w.fake.removeMember(company.orgId as string, company.owner.subject);
    await deliverEvents(w, w.fake.drainEvents());
    expect(await membershipRow(w.t.db, company.owner.membershipId)).toMatchObject({ status: 'removed' });
    expect(await placeOf(w.t.db, company.companyId, owner)).toBeUndefined();
    expect(await placeOf(w.t.db, company.companyId, agent)).toEqual([null, null]);
    const warned = w.t.logs.filter(
      (line) => line.level === LEVEL.warn && line.companyId === company.companyId,
    );
    expect(warned).toMatchObject([
      {
        msg: 'a person left the org chart with flaws',
        principalId: owner,
        violations: [{ code: 'agent_root', principalId: agent }],
      },
    ]);
  });

  it('leaves the chart of a soft-deleted company as it is, also when a membership ends there', async () => {
    const company = await membersCompany(w);
    const team = await managerWithReports(w, company, company.owner);
    const name = (
      (await as(w, company.owner)('GET', `/api/companies/${company.companyId}`)).body as { name: string }
    ).name;
    const deleted = await as(w, company.owner)('DELETE', `/api/companies/${company.companyId}`, {
      confirmName: name,
    });
    expect(deleted.status).toBe(204);
    w.fake.drainEvents();
    await w.fake.removeMember(company.orgId as string, team.joiner.subject);
    await deliverEvents(w, w.fake.drainEvents());
    expect(await membershipRow(w.t.db, team.member.id)).toMatchObject({ status: 'removed' });
    const leaver = team.member.principalId;
    expect(await placeOf(w.t.db, company.companyId, leaver)).toEqual([company.owner.principalId, null]);
    expect(await placeOf(w.t.db, company.companyId, team.agent)).toEqual([leaver, null]);
    expect(await positionAudit(w, team.agent)).toEqual([]);
  });
});
