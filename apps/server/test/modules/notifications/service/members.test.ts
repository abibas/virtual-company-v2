import type { StoredMembership } from '@mwc/identity-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, memberPath, membersCompany } from '../../../fixtures/members/members.ts';
import { companyName, inboxOf, noticingStore, rowsOf, textsOf } from '../../../fixtures/notifications.ts';
import { acceptedFrom, LEARNING_PATHS, learnBy, orgCompany, placedMember } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

// A person hears of their own role change, suspension, reactivation and removal, and an inviter of the invitation
// accepted (S2.9), by whichever path the change comes: the members API, or the identity provider through the store.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('the members API', () => {
  it('tells a person of their new role and of their removal, by the one who did it', async () => {
    const company = await membersCompany(w);
    const name = await companyName(w.t.db, company.companyId);
    const mia = await placedMember(w, company, 'member');
    const changed = await as(w, company.owner)('PATCH', memberPath(company, mia), { role: 'admin' });
    expect(changed.status).toBe(200);
    const [role] = (await inboxOf(w, company, mia)).notifications;
    expect(role).toMatchObject({
      kind: 'role_changed',
      text: `You are now an admin in ${name} (you were a member)`,
      actor: { principalId: company.owner.principalId },
      path: 'structure/people',
    });
    expect((await as(w, company.owner)('DELETE', memberPath(company, mia))).status).toBe(204);
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([
      [mia.principalId, 'role_changed', company.owner.principalId],
      [mia.principalId, 'membership_removed', company.owner.principalId],
    ]);
  });

  it('tells nobody of a role that stays, or of someone leaving on their own', async () => {
    const company = await membersCompany(w);
    const mia = await placedMember(w, company, 'member');
    expect((await as(w, company.owner)('PATCH', memberPath(company, mia), { role: 'member' })).status).toBe(
      200,
    );
    expect((await as(w, mia)('DELETE', memberPath(company, mia))).status).toBe(204);
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([]);
  });
});

describe('the identity store', () => {
  const statusOf = async (companyId: string, userId: string) => {
    const store = noticingStore(w);
    const { id: _id, ...membership } = (await store.getMembership(companyId, userId)) as StoredMembership;
    return { store, membership };
  };

  it('tells a person, by the system, that they are suspended, back, given another role and removed', async () => {
    const company = await membersCompany(w);
    const name = await companyName(w.t.db, company.companyId);
    const mia = await placedMember(w, company, 'member');
    const { store, membership } = await statusOf(company.companyId, mia.userId);
    await store.upsertMembership({ ...membership, status: 'suspended' });
    // Suspended, they cannot read it in the app; it waits there, and goes by email.
    expect(await rowsOf(w.t.db, company.companyId)).toEqual([
      [mia.principalId, 'membership_suspended', null],
    ]);
    await store.upsertMembership({ ...membership, status: 'active' });
    await store.upsertMembership({ ...membership, status: 'active', role: 'viewer', grantedRole: 'viewer' });
    // The same state again changes nothing.
    await store.upsertMembership({ ...membership, status: 'active', role: 'viewer', grantedRole: 'viewer' });
    expect(await textsOf(w, company, mia)).toEqual([
      `You are now a viewer in ${name} (you were a member)`,
      `Your access to ${name} is back`,
      `Your access to ${name} is suspended`,
    ]);
    await store.upsertMembership({ ...membership, status: 'removed' });
    const kinds = (await rowsOf(w.t.db, company.companyId)).map(([, kind, actor]) => [kind, actor]);
    expect(kinds).toEqual([
      ['membership_suspended', null],
      ['membership_reactivated', null],
      ['role_changed', null],
      ['membership_removed', null],
    ]);
  });
});

describe.each(LEARNING_PATHS)('an invitation accepted, learned by %s', (path) => {
  it('tells the inviter once, and not the owner', async () => {
    const company = await orgCompany(w);
    const name = await companyName(w.t.db, company.companyId);
    const joiner = await acceptedFrom(w, company, company.admin);
    await learnBy(w, company, path, { ...joiner, label: 'join' });
    await learnBy(w, company, path, { ...joiner, label: 'join' }, 2);
    const [notice, ...rest] = (await inboxOf(w, company, company.admin)).notifications;
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({
      kind: 'invitation_accepted',
      text: `Invitee ${joiner.subject} accepted your invitation and joined ${name} as a member`,
      actor: null,
      path: 'structure/people',
    });
    expect(await textsOf(w, company, company.owner)).toEqual([]);
  });
});
