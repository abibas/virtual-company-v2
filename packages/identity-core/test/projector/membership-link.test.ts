import type { InvitationStatus } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/projector.ts';
import { identityKeys } from '../../src/store.ts';
import { actions, first, must, variant } from '../fixtures/events.ts';
import { acmeWorld, applyAll, invitationMetadata } from '../fixtures/world.ts';

describe('membership.upserted: linking', () => {
  it('parks a membership until its user is known; the user upsert replays it', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    w.fake.accept(await w.invite('inv-bob', 'bob@x.test', 'member'), 'u_bob');
    const events = w.fake.drainEvents();
    const membership = first(events, 'membership.upserted');
    expect(actions(await project(membership, w.store, w.ctx))).toEqual(['membership:deferred:unknown_user']);
    await project(membership, w.store, w.ctx);
    expect(w.store.snapshot().deferred).toEqual({
      [identityKeys.user(w.ctx.issuer, 'u_bob')]: [membership.externalEventId],
    });
    expect(actions(await project(first(events, 'user.upserted'), w.store, w.ctx))).toEqual([
      'user:created',
      'invitation:accepted',
      'membership:created',
    ]);
    expect(w.store.snapshot().deferred).toEqual({});
    expect(actions(await project(first(events, 'invitation.accepted'), w.store, w.ctx))).toEqual([
      'invitation:ignored:already_accepted',
    ]);
  });

  it('links by mwc_invitation_id and takes the role from our invitation, not from the provider', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    // The provider was asked for a plain member; our invitation row says viewer.
    const sent = await w.fake.createInvitation({
      orgExternalId: w.org.externalId,
      email: 'bob@x.test',
      role: 'member',
      metadata: invitationMetadata('inv-bob', w.company.id),
    });
    w.store.addInvitation({
      id: 'inv-bob',
      companyId: w.company.id,
      email: 'Bob@X.test',
      role: 'viewer',
      externalInvitationId: sent.externalId,
    });
    const external = w.fake.accept(sent.externalId, 'u_bob');
    const changes = await w.apply();
    expect(actions(changes)).toEqual([
      'user:created',
      'invitation:accepted',
      'invitation:updated',
      'membership:created',
    ]);
    expect(await w.membership('u_bob')).toMatchObject({
      role: 'viewer',
      grantedRole: 'viewer',
      status: 'active',
      providerRole: 'org:member',
      externalMembershipId: external.externalMembershipId,
      invitationId: 'inv-bob',
    });
    const bob = must(await w.store.getUser(w.ctx.issuer, 'u_bob'));
    expect(await w.store.getInvitation('inv-bob')).toMatchObject({
      status: 'accepted',
      acceptedByUserId: bob.id,
    });
  });

  it('links by the provider invitation id when the membership carries no metadata', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_carol', email: 'carol@x.test' });
    w.fake.accept(await w.invite('inv-carol', 'carol@x.test', 'admin'), 'u_carol', { copyMetadata: false });
    const events = w.fake.drainEvents();
    expect(first(events, 'membership.upserted').data.metadata).toEqual({});
    await applyAll(
      events.filter((e) => e.type !== 'invitation.accepted'),
      w.store,
      w.ctx,
    );
    expect(await w.membership('u_carol')).toMatchObject({ role: 'admin', invitationId: 'inv-carol' });
    expect((await w.store.getInvitation('inv-carol'))?.status).toBe('accepted');
  });

  it('prefers mwc_invitation_id over the provider invitation id', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    await w.invite('inv-a', 'bob-a@x.test', 'viewer');
    const b = await w.invite('inv-b', 'bob-b@x.test', 'admin');
    w.fake.accept(b, 'u_bob');
    const events = w.fake.drainEvents();
    await project(first(events, 'user.upserted'), w.store, w.ctx);
    const pointed = variant(first(events, 'membership.upserted'), {
      metadata: invitationMetadata('inv-a', w.company.id),
    });
    await project(pointed, w.store, w.ctx);
    // The grant is inv-a's; the provider membership came from inv-b (org:admin), so admin applies.
    expect(await w.membership('u_bob')).toMatchObject({
      invitationId: 'inv-a',
      grantedRole: 'viewer',
      role: 'admin',
    });
    expect((await w.store.getInvitation('inv-b'))?.status).toBe('pending');
  });

  it('learns the provider invitation id from the membership when our row does not know it yet', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_ivan', email: 'ivan@x.test' });
    const sent = await w.invite('inv-ivan', 'ivan@x.test', 'member', { knownExternalId: false });
    w.fake.accept(sent, 'u_ivan');
    const events = w.fake.drainEvents().filter((e) => e.type !== 'invitation.accepted');
    const changes = await applyAll(events, w.store, w.ctx);
    const accepted = changes.find((c) => c.entity === 'invitation');
    expect(accepted?.fields).toContainEqual({ field: 'externalInvitationId', old: null, new: sent });
    expect((await w.store.getInvitation('inv-ivan'))?.externalInvitationId).toBe(sent);
  });
});

describe('membership.upserted: never by email', () => {
  it('does not claim an invitation for the same email in another company', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    const globex = await w.fake.createOrganization({ name: 'Globex', metadata: {} });
    w.store.addCompany({ id: 'c-globex', identityOrgExternalId: globex.externalId });
    w.store.addInvitation({ id: 'inv-globex', companyId: 'c-globex', email: 'bob@x.test', role: 'admin' });
    w.fake.addMember(w.org.externalId, 'u_bob', 'org:member');
    expect(actions(await w.apply())).toEqual([
      'user:created',
      'company:ignored:company_is_local',
      'membership:refused:unlinked',
    ]);
    expect(await w.membership('u_bob')).toBeUndefined();
    expect((await w.store.getInvitation('inv-globex'))?.status).toBe('pending');
  });

  it('does not claim an unrelated invitation for the same email in the same company', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    w.store.addInvitation({ id: 'inv-old', companyId: w.company.id, email: 'bob@x.test', role: 'admin' });
    w.fake.addMember(w.org.externalId, 'u_bob', 'org:member');
    expect(actions(await w.apply())).toEqual(['user:created', 'membership:refused:unlinked']);
    expect(await w.membership('u_bob')).toBeUndefined();

    // Accepting a different invitation links that one only; the old one for the same email stays pending.
    await w.fake.removeMember(w.org.externalId, 'u_bob');
    w.fake.accept(await w.invite('inv-new', 'bob@x.test', 'viewer'), 'u_bob');
    await w.apply();
    expect(await w.membership('u_bob')).toMatchObject({
      invitationId: 'inv-new',
      role: 'viewer',
      status: 'active',
    });
    expect((await w.store.getInvitation('inv-old'))?.status).toBe('pending');
  });

  it('refuses an invitation of another company named by the metadata', async () => {
    const w = await acmeWorld();
    w.store.addCompany({ id: 'c-globex', identityOrgExternalId: 'org_globex' });
    w.store.addInvitation({ id: 'inv-globex', companyId: 'c-globex', email: 'bob@x.test', role: 'admin' });
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    const sent = await w.fake.createInvitation({
      orgExternalId: w.org.externalId,
      email: 'bob@x.test',
      role: 'admin',
      metadata: invitationMetadata('inv-globex', 'c-globex'),
    });
    w.fake.accept(sent.externalId, 'u_bob');
    const changes = await w.apply();
    expect(actions(changes)).toContain('membership:refused:invitation_other_company');
    expect(actions(changes)).toContain('invitation:ignored:invitation_other_company');
    expect(await w.membership('u_bob')).toBeUndefined();
    expect((await w.store.getInvitation('inv-globex'))?.status).toBe('pending');
  });

  it.each<InvitationStatus>(['revoked', 'expired', 'failed'])(
    'refuses a membership from an invitation that is %s here',
    async (status) => {
      const w = await acmeWorld();
      w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
      const sent = await w.fake.createInvitation({
        orgExternalId: w.org.externalId,
        email: 'bob@x.test',
        role: 'member',
        metadata: invitationMetadata('inv-bob', w.company.id),
      });
      w.store.addInvitation({
        id: 'inv-bob',
        companyId: w.company.id,
        email: 'bob@x.test',
        role: 'member',
        status,
        externalInvitationId: sent.externalId,
      });
      w.fake.accept(sent.externalId, 'u_bob');
      const changes = await w.apply();
      expect(actions(changes)).toContain(`membership:refused:invitation_${status}`);
      expect(actions(changes)).toContain(`invitation:refused:invitation_${status}`);
      expect(await w.membership('u_bob')).toBeUndefined();
      expect((await w.store.getInvitation('inv-bob'))?.status).toBe(status);
    },
  );

  it('refuses an invitation another person already accepted', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'admin');
    w.fake.createUser({ subject: 'u_eve', email: 'eve@x.test' });
    const events = w.fake.drainEvents();
    await applyAll(events, w.store, w.ctx);
    const forged = variant(first(events, 'membership.upserted'), {
      subject: 'u_eve',
      externalMembershipId: 'orgmem_forged',
    });
    expect(actions(await project(forged, w.store, w.ctx))).toEqual(['membership:refused:invitation_claimed']);
    expect(await w.membership('u_eve')).toBeUndefined();
  });
});
