import { companies, type IdentityOutboxRow, memberships, userIdentities, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import { brokenDb } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  memberOutboxHandlers,
  OrganizationPendingError,
  queueProviderRemovals,
  removeMemberHandler,
  updateRoleHandler,
} from '../../../../src/modules/members/service/provider.ts';
import { OUTBOX_FIRST_DELAY_MS, processOutboxRow } from '../../../../src/platform/jobs/outbox.ts';
import { joinCompany, loseNextAnswer, outboxOf } from '../../../fixtures/companies/companies.ts';
import {
  addMember,
  as,
  type MembersCompany,
  memberPath,
  membersCompany,
  providerRoleOf,
} from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const deps = () => ({ db: w.t.db, identity: w.fake });
const jobs = () => ({ db: w.t.db, clock: w.clock });
/** The company's outbox rows of `op`, oldest first (ids are UUID v7, made in order). */
const rows = async (companyId: string, op: 'update_role' | 'remove_member') =>
  (await outboxOf(w.t.db, companyId)).filter((row) => row.op === op).sort((a, b) => a.id.localeCompare(b.id));
/** The company's newest outbox row of `op`, as it is now. */
const last = async (companyId: string, op: 'update_role' | 'remove_member') =>
  (await rows(companyId, op)).at(-1) as IdentityOutboxRow;
const runUpdate = (row: IdentityOutboxRow) => processOutboxRow(jobs(), row, updateRoleHandler(deps()));
const runRemove = (row: IdentityOutboxRow) => processOutboxRow(jobs(), row, removeMemberHandler(deps()));
const setRole = async (company: MembersCompany, target: Person, role: string) => {
  const res = await as(w, company.owner)('PATCH', memberPath(company, target), { role });
  if (res.status !== 200) throw new Error(`PATCH answered ${res.status}`);
};
const removeThroughApi = async (company: MembersCompany, target: Person) => {
  const res = await as(w, company.owner)('DELETE', memberPath(company, target));
  if (res.status !== 204) throw new Error(`DELETE answered ${res.status}`);
};
const orgOf = (company: MembersCompany) => company.orgId as string;

describe('update_role', () => {
  it("sets the member's provider role through the provider's role map", async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'viewer');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');
    await setRole(company, target, 'admin');
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:admin');
    expect(await last(company.companyId, 'update_role')).toMatchObject({
      status: 'done',
      attempts: 1,
      completedAt: w.clock(),
    });
    await setRole(company, target, 'owner');
    await setRole(company, target, 'member');
    for (const row of (await rows(company.companyId, 'update_role')).slice(1)) {
      expect(await runUpdate(row)).toBe('done');
    }
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');
  });

  it('pushes the role the membership has when it runs, so calls run out of order end on the latest', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    await setRole(company, target, 'viewer');
    const [toAdmin, toViewer] = await rows(company.companyId, 'update_role');
    const update = vi.spyOn(w.fake, 'updateMemberRole');
    expect(await runUpdate(toViewer as IdentityOutboxRow)).toBe('done');
    expect(await runUpdate(toAdmin as IdentityOutboxRow)).toBe('done');
    expect(update.mock.calls.map((args) => args[2])).toEqual(['viewer', 'viewer']);
    update.mockRestore();
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');
  });

  it('retries after a provider failure, also one after the provider acted, and then converges', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    const row = await last(company.companyId, 'update_role');
    w.fake.failNext('updateMemberRole');
    expect(await runUpdate(row)).toBe('retry');
    expect(await last(company.companyId, 'update_role')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'unavailable: fake: updateMemberRole failed',
      nextAttemptAt: new Date(w.clock().getTime() + OUTBOX_FIRST_DELAY_MS),
    });
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');
    loseNextAnswer(w.fake, 'updateMemberRole');
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('retry');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:admin');
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('done');
    expect(await last(company.companyId, 'update_role')).toMatchObject({
      status: 'done',
      attempts: 3,
      lastError: null,
    });
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:admin');
  });

  it('counts a member the provider no longer has as done, and passes on other provider errors', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    await w.fake.removeMember(orgOf(company), target.subject);
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBeUndefined();

    await setRole(company, target, 'viewer');
    w.fake.failNext('updateMemberRole', new IdentityProviderError('invalid', 'fake: no such role'));
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('retry');
  });

  it('waits while the company has no organization yet, and runs once create_org has linked one', async () => {
    const company = await membersCompany(w, { provisioning: true });
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('retry');
    expect(await last(company.companyId, 'update_role')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: `company ${company.companyId} has no organization at the identity provider yet; trying again later`,
    });
    const org = await w.fake.createOrganization({
      name: 'Late Co',
      metadata: {},
      createdBySubject: company.owner.subject,
    });
    w.fake.addMember(org.externalId, target.subject, 'org:member');
    await rawDb(w.t.db)
      .update(companies)
      .set({ identityOrgId: org.externalId, status: 'active' })
      .where(eq(companies.id, company.companyId));
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('done');
    expect(await providerRoleOf(w, org.externalId, target.subject)).toBe('org:admin');
    expect(new OrganizationPendingError('c').name).toBe('OrganizationPendingError');
  });

  it('needs nothing for a removed membership, a deleted company, a person unknown to the provider or no membership id', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    const row = await last(company.companyId, 'update_role');
    const update = vi.spyOn(w.fake, 'updateMemberRole');
    await removeThroughApi(company, target);
    expect(await runUpdate(row)).toBe('done');
    expect(await updateRoleHandler(deps())({ ...row, payload: {} })).toBeUndefined();
    expect(await updateRoleHandler(deps())({ ...row, payload: { membershipId: 42 } })).toBeUndefined();

    const [stranger] = await rawDb(w.t.db)
      .insert(users)
      .values({ primaryEmail: 'x@elsewhere.test', displayName: 'X' })
      .returning();
    const strangerId = (stranger as { id: string }).id;
    await rawDb(w.t.db)
      .insert(userIdentities)
      .values({ userId: strangerId, provider: 'elsewhere', issuer: 'https://elsewhere.test', subject: 'x' });
    await joinCompany(w.t.db, company.companyId, strangerId, 'member');
    const [membership] = await rawDb(w.t.db)
      .select()
      .from(memberships)
      .where(eq(memberships.userId, strangerId));
    await as(w, company.owner)('PATCH', memberPath(company, membership?.id ?? ''), { role: 'admin' });
    expect(await runUpdate(await last(company.companyId, 'update_role'))).toBe('done');

    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, company.companyId));
    expect(await updateRoleHandler(deps())(row)).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it('rejects without an identity provider (MWC_IDENTITY=none) and on a database failure', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await setRole(company, target, 'admin');
    const row = await last(company.companyId, 'update_role');
    await expect(updateRoleHandler({ db: w.t.db, identity: undefined })(row)).rejects.toThrow(
      /MWC_IDENTITY=none/,
    );
    await expect(updateRoleHandler({ db: brokenDb(), identity: w.fake })(row)).rejects.toThrow();
  });
});

describe('remove_member', () => {
  it('removes the person from the organization; a second run, or a member already gone, is done', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'admin');
    await removeThroughApi(company, target);
    const row = await last(company.companyId, 'remove_member');
    expect(await runRemove(row)).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBeUndefined();
    expect(await removeMemberHandler(deps())(row)).toBeUndefined();
    w.fake.failNext('removeMember', new IdentityProviderError('not_found', 'fake: no such organization'));
    expect(await removeMemberHandler(deps())(row)).toBeUndefined();
  });

  it('retries after a provider failure', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await removeThroughApi(company, target);
    w.fake.failNext('removeMember');
    expect(await runRemove(await last(company.companyId, 'remove_member'))).toBe('retry');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');
    expect(await runRemove(await last(company.companyId, 'remove_member'))).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBeUndefined();
  });

  it('leaves alone a person who is active again here, and waits for an organization not created yet', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    await removeThroughApi(company, target);
    await rawDb(w.t.db)
      .update(memberships)
      .set({ status: 'active' })
      .where(eq(memberships.id, target.membershipId));
    expect(await runRemove(await last(company.companyId, 'remove_member'))).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), target.subject)).toBe('org:member');

    const provisioning = await membersCompany(w, { provisioning: true });
    const leaving = await addMember(w, provisioning, 'member');
    await removeThroughApi(provisioning, leaving);
    expect(await runRemove(await last(provisioning.companyId, 'remove_member'))).toBe('retry');
  });

  it('is offered with update_role by op for the jobs loop', () => {
    expect(Object.keys(memberOutboxHandlers(deps())).sort()).toEqual(['remove_member', 'update_role']);
  });
});

describe('remove_member for a provider membership we refused', () => {
  const removal = (subject: string, externalMembershipId = `orgmem_${subject}`) => ({
    subject,
    externalMembershipId,
    invitationId: '019a4f0c-0000-7000-8000-000000000001',
  });

  it('is queued once per provider membership, and removes the person there', async () => {
    const company = await membersCompany(w);
    const subject = `stranger_${company.companyId.slice(-6)}`;
    w.fake.createUser({ subject, email: `${subject}@x.test` });
    const membership = w.fake.addMember(orgOf(company), subject, 'org:member');
    const one = removal(subject, membership.externalMembershipId);
    expect(await queueProviderRemovals(w.t.db, company.companyId, [one])).toBe(1);
    expect(await queueProviderRemovals(w.t.db, company.companyId, [one])).toBe(0);
    expect(await queueProviderRemovals(w.t.db, company.companyId, [])).toBe(0);
    const row = await last(company.companyId, 'remove_member');
    expect(row).toMatchObject({
      idempotencyKey: `remove_member:provider:${membership.externalMembershipId}`,
      payload: one,
    });
    expect(await runRemove(row)).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), subject)).toBeUndefined();
    expect(await runRemove({ ...row, status: 'pending' })).toBe('done');
  });

  it('leaves an active member here alone, waits for the organization, and needs nothing in a deleted company', async () => {
    const company = await membersCompany(w);
    const member = await addMember(w, company, 'member');
    await queueProviderRemovals(w.t.db, company.companyId, [removal(member.subject)]);
    expect(await runRemove(await last(company.companyId, 'remove_member'))).toBe('done');
    expect(await providerRoleOf(w, orgOf(company), member.subject)).toBe('org:member');

    const provisioning = await membersCompany(w, { provisioning: true });
    await queueProviderRemovals(w.t.db, provisioning.companyId, [removal('someone')]);
    const waiting = await last(provisioning.companyId, 'remove_member');
    expect(await runRemove(waiting)).toBe('retry');
    expect((await last(provisioning.companyId, 'remove_member')).lastError).toBe(
      new OrganizationPendingError(provisioning.companyId).message,
    );
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, provisioning.companyId));
    expect(await runRemove(await last(provisioning.companyId, 'remove_member'))).toBe('done');
    expect(await queueProviderRemovals(w.t.db, provisioning.companyId, [removal('late')])).toBe(0);
  });
});
