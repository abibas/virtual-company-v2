import { describe, expect, it } from 'vitest';
import { project } from '../../src/projector.ts';
import type { Event } from '../fixtures/events.ts';
import { actions, first, must, variant } from '../fixtures/events.ts';
import { acmeWorld, applyAll, invitationMetadata } from '../fixtures/world.ts';

describe('membership.upserted: roles and order', () => {
  it('follows the provider admin role up and down, never above admin, never below the grant', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.join('u_carol', 'admin');
    await w.apply();
    const roleOf = async (subject: string) => (await w.membership(subject))?.role;

    await w.fake.updateMemberRole(w.org.externalId, 'u_bob', 'owner');
    expect(actions(await w.apply())).toEqual(['membership:updated']);
    expect(await roleOf('u_bob')).toBe('admin');
    await w.fake.updateMemberRole(w.org.externalId, 'u_bob', 'member');
    await w.apply();
    expect(await w.membership('u_bob')).toMatchObject({ role: 'member', grantedRole: 'member' });

    await w.fake.updateMemberRole(w.org.externalId, 'u_carol', 'member');
    await w.apply();
    expect(await w.membership('u_carol')).toMatchObject({ role: 'admin', providerRole: 'org:member' });
  });

  it('never demotes a local owner', async () => {
    const w = await acmeWorld();
    await w.fake.updateMemberRole(w.org.externalId, 'u_owner', 'member');
    const changes = await w.apply();
    expect(actions(changes)).toEqual(['membership:updated']);
    expect(await w.membership('u_owner')).toMatchObject({
      role: 'owner',
      grantedRole: 'owner',
      providerRole: 'org:member',
    });
  });

  it('ignores an upsert older than the one applied', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.fake.updateMemberRole(w.org.externalId, 'u_bob', 'admin');
    const events = w.fake.drainEvents();
    const [joined, promoted] = events.filter(
      (e): e is Event<'membership.upserted'> => e.type === 'membership.upserted',
    );
    await applyAll([first(events, 'user.upserted'), must(promoted)], w.store, w.ctx);
    const changes = await project(must(joined), w.store, w.ctx);
    expect(actions(changes)).toEqual(['membership:ignored:not_newer']);
    expect(await w.membership('u_bob')).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('keeps a removal made here when the provider changes that membership', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.apply();
    const row = must(await w.membership('u_bob'));
    const { id: _id, ...rest } = row;
    await w.store.upsertMembership({ ...rest, status: 'removed' });
    await w.fake.updateMemberRole(w.org.externalId, 'u_bob', 'admin');
    await w.apply();
    expect(await w.membership('u_bob')).toMatchObject({ status: 'removed', providerRole: 'org:admin' });
  });

  it('reactivates a removed person who accepts a new invitation, with that invitation role', async () => {
    const w = await acmeWorld();
    await w.join('u_dave', 'viewer', 'inv-dave-1');
    await w.fake.removeMember(w.org.externalId, 'u_dave');
    await w.apply();
    expect((await w.membership('u_dave'))?.status).toBe('removed');
    w.fake.accept(await w.invite('inv-dave-2', 'u_dave@x.test', 'admin'), 'u_dave');
    // invitation.accepted comes first (status), then the membership records who accepted it.
    expect(actions(await w.apply())).toEqual([
      'invitation:accepted',
      'invitation:updated',
      'membership:reactivated',
    ]);
    expect(await w.membership('u_dave')).toMatchObject({
      status: 'active',
      role: 'admin',
      grantedRole: 'admin',
      invitationId: 'inv-dave-2',
    });
  });

  it('refuses a provider membership that replaces a removed one without an invitation, in either order', async () => {
    const w = await acmeWorld();
    await w.join('u_judy', 'member');
    await w.fake.removeMember(w.org.externalId, 'u_judy');
    const readded = w.fake.addMember(w.org.externalId, 'u_judy', 'org:admin');
    const events = w.fake.drainEvents();
    const deleted = first(events, 'membership.deleted');
    const replacement = events
      .filter((e) => e.type === 'membership.upserted')
      .at(-1) as Event<'membership.upserted'>;
    expect(replacement.data.externalMembershipId).toBe(readded.externalMembershipId);
    const earlier = events.filter((e) => e !== deleted && e !== replacement);
    await applyAll(earlier, w.store, w.ctx);
    const before = w.store.snapshot();

    // The replacement first: refused, nothing changes; then the deletion removes the old membership.
    expect(actions(await project(replacement, w.store, w.ctx))).toEqual(['membership:refused:unlinked']);
    expect(w.store.snapshot()).toEqual(before);
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['membership:removed:provider_deleted']);
    expect(await w.membership('u_judy')).toMatchObject({ status: 'removed', role: 'member' });
    expect(actions(await project(replacement, w.store, w.ctx))).toEqual(['membership:refused:unlinked']);
  });

  it('creates the membership of a deleted person as removed', async () => {
    const w = await acmeWorld();
    await w.join('u_frank', 'member');
    w.fake.deleteUser('u_frank');
    const events = w.fake.drainEvents();
    await applyAll(
      events.filter((e) => e.type === 'user.upserted' || e.type === 'user.deleted'),
      w.store,
      w.ctx,
    );
    expect(actions(await project(first(events, 'membership.upserted'), w.store, w.ctx))).toEqual([
      'invitation:accepted',
      'membership:created',
    ]);
    expect((await w.membership('u_frank'))?.status).toBe('removed');
  });
});

describe('membership.upserted: rows made here', () => {
  it('lands the creator row removed when its provider membership was deleted before it was adopted', async () => {
    const w = await acmeWorld();
    const [creator] = await (async () => {
      const members = [];
      for await (const m of w.fake.listOrganizationMembers(w.org.externalId)) members.push(m);
      return members;
    })();
    await w.fake.removeMember(w.org.externalId, 'u_owner');
    const deleted = first(w.fake.drainEvents(), 'membership.deleted');
    const upserted: Event<'membership.upserted'> = {
      provider: 'fake',
      externalEventId: 'evt_creator',
      occurredAt: must(creator).updatedAt,
      type: 'membership.upserted',
      data: must(creator),
    };
    // The row follows no provider membership yet, so the deletion is only remembered...
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['membership:ignored:other_membership']);
    expect((await w.membership('u_owner'))?.status).toBe('active');
    // ...and adopting that membership afterwards ends the same as the other order: removed.
    expect(actions(await project(upserted, w.store, w.ctx))).toEqual(['membership:removed:provider_deleted']);
    expect(await w.membership('u_owner')).toMatchObject({ status: 'removed', role: 'owner' });
  });

  it('adopts a provider membership that names a refused invitation, and says so', async () => {
    const w = await acmeWorld();
    const pat = w.fake.createUser({ subject: 'u_pat', email: 'pat@x.test' });
    const row = w.store.addUser({
      issuer: w.ctx.issuer,
      subject: pat.subject,
      primaryEmail: pat.primaryEmail,
      displayName: pat.displayName,
    });
    w.store.addMembership({ companyId: w.company.id, userId: row.id, role: 'member', status: 'invited' });
    w.store.addInvitation({
      id: 'inv-pat',
      companyId: w.company.id,
      email: 'pat@x.test',
      role: 'admin',
      status: 'revoked',
    });
    const sent = await w.fake.createInvitation({
      orgExternalId: w.org.externalId,
      email: 'pat@x.test',
      role: 'admin',
      metadata: invitationMetadata('inv-pat', w.company.id),
    });
    w.fake.accept(sent.externalId, 'u_pat');
    const membership = first(w.fake.drainEvents(), 'membership.upserted');
    expect(actions(await project(membership, w.store, w.ctx))).toEqual([
      'membership:refused:invitation_revoked',
      'membership:updated',
    ]);
    expect(await w.membership('u_pat')).toMatchObject({
      status: 'invited',
      grantedRole: 'member',
      role: 'admin',
      externalMembershipId: membership.data.externalMembershipId,
      invitationId: null,
    });
  });
});

describe('membership.deleted', () => {
  it('removes the membership, and a stale or newer upsert of it never revives it', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.fake.removeMember(w.org.externalId, 'u_bob');
    const events = w.fake.drainEvents();
    const changes = await applyAll(events, w.store, w.ctx);
    expect(changes.at(-1)).toMatchObject({
      entity: 'membership',
      action: 'removed',
      reason: 'provider_deleted',
      fields: [{ field: 'status', old: 'active', new: 'removed' }],
    });
    const upserted = first(events, 'membership.upserted');
    expect(actions(await project(upserted, w.store, w.ctx))).toEqual(['membership:ignored:not_newer']);
    const newer = variant(upserted, { providerRole: 'org:admin', updatedAt: upserted.data.updatedAt + 100 });
    expect(actions(await project(newer, w.store, w.ctx))).toEqual(['membership:updated']);
    expect(await w.membership('u_bob')).toMatchObject({ status: 'removed', role: 'admin' });
  });

  it('is remembered before the membership is known, so it lands removed', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.fake.removeMember(w.org.externalId, 'u_bob');
    const events = w.fake.drainEvents();
    const deleted = first(events, 'membership.deleted');
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual([
      'membership:ignored:unknown_membership',
    ]);
    await applyAll(
      events.filter((e) => e !== deleted),
      w.store,
      w.ctx,
    );
    expect((await w.membership('u_bob'))?.status).toBe('removed');
    expect((await w.store.getInvitation('inv-u_bob'))?.status).toBe('accepted');
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['membership:ignored:already_removed']);
  });

  it('ignores the deletion of a provider membership the row no longer follows, or of an unknown company', async () => {
    const w = await acmeWorld();
    await w.join('u_dave', 'member', 'inv-dave-1');
    await w.fake.removeMember(w.org.externalId, 'u_dave');
    w.fake.accept(await w.invite('inv-dave-2', 'u_dave@x.test', 'member'), 'u_dave');
    const events = w.fake.drainEvents();
    const deleted = first(events, 'membership.deleted');
    await applyAll(
      events.filter((e) => e !== deleted),
      w.store,
      w.ctx,
    );
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['membership:ignored:other_membership']);
    expect((await w.membership('u_dave'))?.status).toBe('active');
    const elsewhere = variant(deleted, { orgExternalId: 'org_unknown' });
    expect(await project(elsewhere, w.store, w.ctx)).toMatchObject([{ id: null, companyId: null }]);
  });
});
