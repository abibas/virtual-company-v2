import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { InMemoryIdentityStore } from '../src/memory-store.ts';
import { identityKeys } from '../src/store.ts';

const ISSUER = 'https://issuer.test';

function parked(id: string): NormalizedIdentityEvent {
  return {
    provider: 'fake',
    externalEventId: id,
    occurredAt: 1,
    type: 'user.deleted',
    data: { subject: 's' },
  };
}

// The port's behaviour (upserts keep ids, lookups, marks, parking) is the IdentityStore contract's
// (@mwc/testkit/store-contract), which runs against this store and the database store; these tests cover
// what only the in-memory store has: its seeding helpers and its snapshot.
describe('InMemoryIdentityStore', () => {
  it('seeds companies, users, memberships and invitations with defaults', async () => {
    const store = new InMemoryIdentityStore();
    const company = store.addCompany({ identityOrgExternalId: null });
    expect(company).toEqual({ id: expect.any(String), identityOrgExternalId: null, status: 'active' });
    expect(store.linkCompany(company.id, 'org_1').identityOrgExternalId).toBe('org_1');
    expect(await store.getCompany(company.id)).toMatchObject({ identityOrgExternalId: 'org_1' });
    expect(await store.getCompanyByOrgExternalId('org_1')).toMatchObject({ id: company.id });
    expect(await store.getCompanyByOrgExternalId('org_2')).toBeUndefined();

    const user = store.addUser({ issuer: ISSUER, subject: 's1', primaryEmail: 'A@X.test', displayName: 'A' });
    expect(user).toMatchObject({ primaryEmail: 'a@x.test', imageUrl: null, status: 'active' });
    expect(await store.getUserById(user.id)).toEqual(user);
    expect(await store.getUser(ISSUER, 's1')).toEqual(user);
    expect(await store.getUser('https://other', 's1')).toBeUndefined();

    const membership = store.addMembership({ companyId: company.id, userId: user.id, role: 'admin' });
    expect(membership).toMatchObject({
      role: 'admin',
      grantedRole: 'admin',
      status: 'active',
      externalMembershipId: null,
      providerRole: null,
      invitationId: null,
    });
    expect(await store.listMemberships({ companyId: company.id })).toEqual([membership]);
    expect(await store.listMemberships({ userId: user.id })).toEqual([membership]);
    expect(await store.listMemberships({ userId: 'nobody' })).toEqual([]);
    const { id, ...rest } = membership;
    expect((await store.upsertMembership({ ...rest, status: 'removed' })).id).toBe(id);

    const invitation = store.addInvitation({ companyId: company.id, email: 'B@X.test', role: 'member' });
    expect(invitation).toMatchObject({ email: 'b@x.test', status: 'pending', externalInvitationId: null });
    const updated = await store.updateInvitation(invitation.id, { externalInvitationId: 'orginv_1' });
    expect(await store.getInvitationByExternalId('orginv_1')).toEqual(updated);
  });

  it('refuses to link or update what it does not hold', async () => {
    const store = new InMemoryIdentityStore();
    expect(() => store.linkCompany('c404', 'org_1')).toThrow('no company c404');
    await expect(store.updateInvitation('inv404', { status: 'revoked' })).rejects.toThrow(
      'no invitation inv404',
    );
  });

  it('snapshots with natural keys, so stores built in different orders compare equal', async () => {
    const build = (order: 'ab' | 'ba') => {
      const store = new InMemoryIdentityStore();
      store.addCompany({ id: 'c1', identityOrgExternalId: 'org_1' });
      const users = (order === 'ab' ? ['a', 'b'] : ['b', 'a']).map((s) =>
        store.addUser({ issuer: ISSUER, subject: s, primaryEmail: `${s}@x.test`, displayName: s }),
      );
      for (const user of users) {
        store.addMembership({ companyId: 'c1', userId: user.id, role: 'member' });
        void store.setMark(identityKeys.membership('c1', user.id), { at: 5, deleted: false });
      }
      return store;
    };
    expect(build('ab').snapshot()).toEqual(build('ba').snapshot());
    const snapshot = build('ab').snapshot();
    expect(snapshot.memberships.map((m) => m.user)).toEqual(['a', 'b']);
    expect(Object.keys(snapshot.marks)).toEqual(['membership:c1|@a', 'membership:c1|@b']);

    const orphan = new InMemoryIdentityStore();
    orphan.addMembership({ companyId: 'c1', userId: 'missing', role: 'viewer' });
    await orphan.defer('k', parked('e1'));
    await orphan.defer('j', parked('e3'));
    await orphan.defer('empty', parked('e2'));
    await orphan.takeDeferred('empty');
    const snapshot2 = orphan.snapshot();
    expect(snapshot2).toMatchObject({
      memberships: [{ user: '?missing' }],
      deferred: { j: ['e3'], k: ['e1'] },
    });
    expect(Object.keys(snapshot2.deferred)).toEqual(['j', 'k']);
  });
});
