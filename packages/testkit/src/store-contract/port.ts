import type { NewStoredMembership, NewStoredUser, StoredMembership } from '@mwc/identity-core';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { expect } from 'vitest';
import type { StoreContractCase } from './target.ts';

/** The port's own behaviour, method by method, each case on a fresh store. */

const ISSUER = 'https://issuer.test';
/** A well-formed id that no row has, and ids no database column could hold. */
const MISSING = '0190f5f0-0000-7000-8000-000000000000';
const MALFORMED = ['c404', 'inv-404', ''];

const person = (subject: string, issuer = ISSUER): NewStoredUser => ({
  issuer,
  subject,
  primaryEmail: `${subject}@x.test`,
  displayName: subject.toUpperCase(),
  imageUrl: null,
  status: 'active',
});

const byId = (rows: readonly StoredMembership[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

export const keepsUsers: StoreContractCase = {
  name: 'upsertUser inserts by (issuer, subject) and updates in place (a name or photo to none too); getUser reads it back',
  async run(target) {
    const { store } = await target.fresh();
    const created = await store.upsertUser(person('s1'));
    expect(created).toEqual({ id: expect.any(String), ...person('s1') });
    expect(await store.getUser(ISSUER, 's1')).toEqual(created);
    expect(await store.getUserById(created.id)).toEqual(created);
    const changed = {
      ...person('s1'),
      displayName: 'B',
      imageUrl: 'https://img.test/b.png',
      status: 'deactivated' as const,
    };
    expect(await store.upsertUser(changed)).toEqual({ ...changed, id: created.id });
    // A person without a name and a photo taken away: both null, read back as null.
    const bare = { ...changed, displayName: null, imageUrl: null };
    expect(await store.upsertUser(bare)).toEqual({ ...bare, id: created.id });
    expect(await store.getUser(ISSUER, 's1')).toEqual({ ...bare, id: created.id });
    // Another issuer's subject is another person, even with the same email.
    const other = await store.upsertUser(person('s1', 'https://other.test'));
    expect(other.id).not.toBe(created.id);
    expect(await store.getUser(ISSUER, 'nobody')).toBeUndefined();
    expect(await store.getUser('https://nobody.test', 's1')).toBeUndefined();
    for (const id of [MISSING, ...MALFORMED]) expect(await store.getUserById(id)).toBeUndefined();
  },
};

export const readsCompanies: StoreContractCase = {
  name: 'getCompany and getCompanyByOrgExternalId read a company and its organization link',
  async run(target) {
    const s = await target.fresh();
    const linked = await s.addCompany({ identityOrgExternalId: 'org_1' });
    const pending = await s.addCompany({ identityOrgExternalId: null, status: 'provisioning' });
    expect(linked).toEqual({ id: expect.any(String), identityOrgExternalId: 'org_1', status: 'active' });
    expect(await s.store.getCompany(linked.id)).toEqual(linked);
    expect(await s.store.getCompany(pending.id)).toEqual({
      id: pending.id,
      identityOrgExternalId: null,
      status: 'provisioning',
    });
    expect(await s.store.getCompanyByOrgExternalId('org_1')).toEqual(linked);
    expect(await s.store.getCompanyByOrgExternalId('org_2')).toBeUndefined();
    for (const id of [MISSING, ...MALFORMED]) expect(await s.store.getCompany(id)).toBeUndefined();
  },
};

export const keepsMemberships: StoreContractCase = {
  name: 'upsertMembership inserts by (companyId, userId) and updates in place; listMemberships by company and by user',
  async run(target) {
    const s = await target.fresh();
    const acme = await s.addCompany({ identityOrgExternalId: 'org_1' });
    const globex = await s.addCompany({ identityOrgExternalId: 'org_2' });
    const [bob, carol] = [await s.store.upsertUser(person('bob')), await s.store.upsertUser(person('carol'))];
    const invitation = await s.addInvitation({ companyId: acme.id, email: 'bob@x.test', role: 'member' });
    const input: NewStoredMembership = {
      companyId: acme.id,
      userId: bob.id,
      role: 'admin',
      grantedRole: 'member',
      status: 'active',
      externalMembershipId: 'mem_1',
      providerRole: 'org:admin',
      invitationId: invitation.id,
    };
    const created = await s.store.upsertMembership(input);
    expect(created).toEqual({ id: expect.any(String), ...input });
    expect(await s.store.getMembership(acme.id, bob.id)).toEqual(created);
    const removed = {
      ...input,
      role: 'member' as const,
      status: 'removed' as const,
      providerRole: 'org:member',
    };
    expect(await s.store.upsertMembership(removed)).toEqual({ ...removed, id: created.id });

    const seeded = await s.addMembership({ companyId: globex.id, userId: bob.id, role: 'owner' });
    expect(seeded).toEqual({
      id: expect.any(String),
      companyId: globex.id,
      userId: bob.id,
      role: 'owner',
      grantedRole: 'owner',
      status: 'active',
      externalMembershipId: null,
      providerRole: null,
      invitationId: null,
    });
    const carolInAcme = await s.addMembership({
      companyId: acme.id,
      userId: carol.id,
      role: 'viewer',
      status: 'invited',
    });
    expect(byId(await s.store.listMemberships({ companyId: acme.id }))).toEqual(
      byId([{ ...removed, id: created.id }, carolInAcme]),
    );
    expect(byId(await s.store.listMemberships({ userId: bob.id }))).toEqual(
      byId([{ ...removed, id: created.id }, seeded]),
    );
    expect(await s.store.getMembership(globex.id, carol.id)).toBeUndefined();
    for (const id of [MISSING, ...MALFORMED]) {
      expect(await s.store.getMembership(id, bob.id)).toBeUndefined();
      expect(await s.store.getMembership(acme.id, id)).toBeUndefined();
      expect(await s.store.listMemberships({ companyId: id })).toEqual([]);
      expect(await s.store.listMemberships({ userId: id })).toEqual([]);
    }
  },
};

export const keepsInvitations: StoreContractCase = {
  name: 'getInvitation, getInvitationByExternalId and updateInvitation (only the patched fields; unknown ids reject)',
  async run(target) {
    const s = await target.fresh();
    const acme = await s.addCompany({ identityOrgExternalId: 'org_1' });
    const bob = await s.store.upsertUser(person('bob'));
    const invitation = await s.addInvitation({ companyId: acme.id, email: 'Bob@X.test', role: 'member' });
    expect(invitation).toEqual({
      id: expect.any(String),
      companyId: acme.id,
      email: 'bob@x.test',
      role: 'member',
      status: 'pending',
      externalInvitationId: null,
      acceptedByUserId: null,
    });
    expect(await s.store.getInvitation(invitation.id)).toEqual(invitation);
    const learned = await s.store.updateInvitation(invitation.id, { externalInvitationId: 'orginv_1' });
    expect(learned).toEqual({ ...invitation, externalInvitationId: 'orginv_1' });
    expect(await s.store.getInvitationByExternalId('orginv_1')).toEqual(learned);
    const accepted = await s.store.updateInvitation(invitation.id, {
      status: 'accepted',
      acceptedByUserId: bob.id,
    });
    expect(accepted).toEqual({ ...learned, status: 'accepted', acceptedByUserId: bob.id });
    expect(await s.store.updateInvitation(invitation.id, {})).toEqual(accepted);
    expect(await s.store.getInvitationByExternalId('orginv_404')).toBeUndefined();
    for (const id of [MISSING, ...MALFORMED]) {
      expect(await s.store.getInvitation(id)).toBeUndefined();
      await expect(s.store.updateInvitation(id, { status: 'revoked' })).rejects.toThrow(
        `no invitation ${id}`,
      );
    }
  },
};

export const keepsMarks: StoreContractCase = {
  name: 'getMark answers undefined until setMark, which replaces the mark (exact milliseconds)',
  async run(target) {
    const { store } = await target.fresh();
    expect(await store.getMark('user:a|b')).toBeUndefined();
    await store.setMark('user:a|b', { at: 1_762_171_200_123, deleted: false });
    expect(await store.getMark('user:a|b')).toEqual({ at: 1_762_171_200_123, deleted: false });
    await store.setMark('user:a|b', { at: null, deleted: true });
    expect(await store.getMark('user:a|b')).toEqual({ at: null, deleted: true });
    expect(await store.getMark('user:a|c')).toBeUndefined();
  },
};

function parked(id: string): NormalizedIdentityEvent {
  return {
    provider: 'fake',
    externalEventId: id,
    occurredAt: 1_762_171_200_000,
    type: 'membership.upserted',
    data: {
      orgExternalId: 'org_1',
      subject: 's',
      externalMembershipId: 'mem_1',
      providerRole: 'org:member',
      metadata: { mwc_invitation_id: 'inv-1', nested: { a: [1, 2] } },
      updatedAt: 1_762_171_200_000,
    },
  };
}

export const parksEvents: StoreContractCase = {
  name: 'defer parks each event once per key; takeDeferred hands them back whole, oldest first, once',
  async run(target) {
    const { store } = await target.fresh();
    await store.defer('org:org_1', parked('e1'));
    await store.defer('org:org_1', parked('e2'));
    await store.defer('org:org_1', parked('e1'));
    await store.defer('user:a|b', parked('e1'));
    expect(await store.takeDeferred('org:org_1')).toEqual([parked('e1'), parked('e2')]);
    expect(await store.takeDeferred('org:org_1')).toEqual([]);
    expect(await store.takeDeferred('user:a|b')).toEqual([parked('e1')]);
    expect(await store.takeDeferred('nothing')).toEqual([]);
  },
};

export const PORT_CASES: readonly StoreContractCase[] = [
  keepsUsers,
  readsCompanies,
  keepsMemberships,
  keepsInvitations,
  keepsMarks,
  parksEvents,
];
