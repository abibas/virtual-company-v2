import type { InvitationStatus, MembershipRole, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { FAKE_ROLES } from '../src/fake.ts';
import { InMemoryIdentityStore } from '../src/memory-store.ts';
import { effectiveRole, type ProjectionChange, project, projectionContext } from '../src/projector.ts';
import { identityKeys } from '../src/store.ts';
import { acmeWorld, applyAll, invitationMetadata, world } from './fixtures/world.ts';

type Event<T extends NormalizedIdentityEvent['type']> = Extract<NormalizedIdentityEvent, { type: T }>;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The first event of a type. */
function first<T extends NormalizedIdentityEvent['type']>(
  events: readonly NormalizedIdentityEvent[],
  type: T,
): Event<T> {
  return must(events.find((e): e is Event<T> => e.type === type));
}

/** The event as the provider would send a different state of it (a new delivery id). */
let variants = 0;
function variant<E extends NormalizedIdentityEvent>(event: E, data: Partial<E['data']>): E {
  variants++;
  return {
    ...event,
    externalEventId: `${event.externalEventId}~${variants}`,
    data: { ...event.data, ...data },
  } as E;
}

function actions(changes: readonly ProjectionChange[]): string[] {
  return changes.map((c) => `${c.entity}:${c.action}${c.reason ? `:${c.reason}` : ''}`);
}

describe('projectionContext and effectiveRole', () => {
  it('takes the issuer and the role map from the provider', () => {
    const { fake, ctx } = world();
    expect(ctx).toEqual({ issuer: fake.issuer, roles: fake.roles });
    expect(projectionContext({ issuer: 'https://i', roles: FAKE_ROLES }).issuer).toBe('https://i');
  });

  it.each<[MembershipRole, string | null, MembershipRole]>([
    ['owner', 'org:member', 'owner'],
    ['owner', 'org:admin', 'owner'],
    ['owner', null, 'owner'],
    ['admin', 'org:member', 'admin'],
    ['member', 'org:admin', 'admin'],
    ['viewer', 'org:admin', 'admin'],
    ['member', 'org:member', 'member'],
    ['viewer', 'org:billing', 'viewer'],
    ['member', null, 'member'],
  ])('granted %s with provider role %s applies as %s', (granted, providerRole, expected) => {
    expect(effectiveRole(granted, providerRole, FAKE_ROLES)).toBe(expected);
  });
});

describe('user.upserted', () => {
  it('creates the user with a lower-cased email and reports every field', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test', displayName: 'Ann', imageUrl: 'https://i/a.png' });
    const event = first(fake.drainEvents(), 'user.upserted');
    const shouting = variant(event, { primaryEmail: 'Ann@X.Test' });
    expect(await project(shouting, store, ctx)).toEqual([
      {
        entity: 'user',
        action: 'created',
        id: expect.any(String),
        companyId: null,
        reason: null,
        eventId: shouting.externalEventId,
        fields: [
          { field: 'primaryEmail', old: null, new: 'ann@x.test' },
          { field: 'displayName', old: null, new: 'Ann' },
          { field: 'imageUrl', old: null, new: 'https://i/a.png' },
          { field: 'status', old: null, new: 'active' },
        ],
      },
    ]);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      primaryEmail: 'ann@x.test',
      status: 'active',
    });
  });

  it('applies a newer state with only the changed fields and ignores an equal or older one', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    fake.updateUser('u1', { displayName: 'Ann' });
    fake.updateUser('u1', { email: 'ann@x.test' });
    const [created, renamed, moved] = fake.drainEvents() as Event<'user.upserted'>[];
    await project(must(created), store, ctx);
    const changes = await project(must(moved), store, ctx);
    expect(actions(changes)).toEqual(['user:updated']);
    expect(changes[0]?.fields.map((f) => f.field)).toEqual(['primaryEmail', 'displayName']);
    expect(actions(await project(must(renamed), store, ctx))).toEqual(['user:ignored:not_newer']);
    expect(actions(await project(must(moved), store, ctx))).toEqual(['user:ignored:not_newer']);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      primaryEmail: 'ann@x.test',
      displayName: 'Ann',
    });

    // A newer state with the same fields moves the mark and reports nothing.
    const at = must(moved).data.updatedAt + 5;
    expect(await project(variant(must(moved), { updatedAt: at }), store, ctx)).toEqual([]);
    expect(await store.getMark(identityKeys.user(ctx.issuer, 'u1'))).toEqual({ at, deleted: false });
  });
});

describe('user.deleted', () => {
  it('deactivates the user and removes every membership they have', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.apply();
    const bob = must(await w.store.getUser(w.ctx.issuer, 'u_bob'));
    const globex = w.store.addCompany({ id: 'c-globex', identityOrgExternalId: 'org_elsewhere' });
    w.store.addMembership({ companyId: globex.id, userId: bob.id, role: 'viewer' });

    w.fake.deleteUser('u_bob');
    const events = w.fake.drainEvents();
    expect(events.map((e) => e.type)).toEqual(['membership.deleted', 'user.deleted']);
    const deleted = first(events, 'user.deleted');
    // The user's deletion alone (its membership's deletion lost) ends access everywhere.
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual([
      'user:deactivated',
      'membership:removed:user_deleted',
      'membership:removed:user_deleted',
    ]);
    expect((await w.store.getUser(w.ctx.issuer, 'u_bob'))?.status).toBe('deactivated');
    expect((await w.store.listMemberships({ userId: bob.id })).map((m) => m.status)).toEqual([
      'removed',
      'removed',
    ]);
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['user:ignored:already_deleted']);
    expect(actions(await project(first(events, 'membership.deleted'), w.store, w.ctx))).toEqual([
      'membership:ignored:already_removed',
    ]);
  });

  it('is remembered for a user not seen yet, so their late upsert lands deactivated', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    fake.deleteUser('u1');
    const events = fake.drainEvents();
    expect(actions(await project(first(events, 'user.deleted'), store, ctx))).toEqual([
      'user:ignored:unknown_user',
    ]);
    expect(actions(await project(first(events, 'user.upserted'), store, ctx))).toEqual(['user:created']);
    expect((await store.getUser(ctx.issuer, 'u1'))?.status).toBe('deactivated');
    // A later, newer profile change does not bring the user back either.
    const upserted = first(events, 'user.upserted');
    const later = variant(upserted, { displayName: 'Back', updatedAt: upserted.data.updatedAt + 1000 });
    expect(actions(await project(later, store, ctx))).toEqual(['user:updated']);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      displayName: 'Back',
      status: 'deactivated',
    });
  });
});

describe('org.upserted and org.deleted', () => {
  it('parks memberships of an organization no company is linked to, and replays them once one is', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    const org = await fake.createOrganization({ name: 'Acme', metadata: {}, createdBySubject: 'u1' });
    const events = fake.drainEvents();
    const orgEvent = first(events, 'org.upserted');
    const membership = first(events, 'membership.upserted');
    await project(first(events, 'user.upserted'), store, ctx);

    expect(actions(await project(membership, store, ctx))).toEqual(['membership:deferred:unknown_company']);
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['company:ignored:unknown_company']);
    expect(store.snapshot().deferred).toEqual({
      [identityKeys.org(org.externalId)]: [membership.externalEventId],
    });

    // The outbox links the company it created (S1.5); the creator's local owner row already exists.
    store.addCompany({ id: 'c1', identityOrgExternalId: null });
    store.linkCompany('c1', org.externalId);
    const user = must(await store.getUser(ctx.issuer, 'u1'));
    store.addMembership({ companyId: 'c1', userId: user.id, role: 'owner' });
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['membership:updated']);
    expect(await store.getMembership('c1', user.id)).toMatchObject({
      role: 'owner',
      status: 'active',
      externalMembershipId: membership.data.externalMembershipId,
      providerRole: 'org:admin',
    });
    expect(store.snapshot().deferred).toEqual({});
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['company:ignored:company_is_local']);
  });

  it('ignores the deletion of an organization: companies are local', async () => {
    const w = await acmeWorld();
    await w.fake.deleteOrganization(w.org.externalId);
    const [deleted] = w.fake.drainEvents();
    const before = w.store.snapshot();
    const changes = await project(must(deleted), w.store, w.ctx);
    expect(changes).toMatchObject([{ entity: 'company', action: 'ignored', id: w.company.id }]);
    expect(actions(changes)).toEqual(['company:ignored:org_deleted_upstream']);
    expect(w.store.snapshot()).toEqual(before);
    const elsewhere = { ...must(deleted), data: { externalId: 'org_unknown' } } as NormalizedIdentityEvent;
    expect((await project(elsewhere, w.store, w.ctx))[0]?.id).toBeNull();
  });
});

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

describe('invitation.accepted and invitation.revoked', () => {
  it('marks the invitation accepted by mwc_invitation_id, or by the provider id without metadata', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    w.fake.createUser({ subject: 'u_hank', email: 'hank@x.test' });
    w.fake.accept(await w.invite('inv-bob', 'bob@x.test', 'member'), 'u_bob');
    w.fake.accept(await w.invite('inv-hank', 'hank@x.test', 'member', { metadata: false }), 'u_hank', {
      includeInvitationId: false,
    });
    const accepted = w.fake.drainEvents().filter((e) => e.type === 'invitation.accepted');
    expect(accepted.map((e) => Object.keys(e.data.metadata).length)).toEqual([2, 0]);
    expect(actions(await applyAll(accepted, w.store, w.ctx))).toEqual([
      'invitation:accepted',
      'invitation:accepted',
    ]);
    expect(await w.store.getInvitation('inv-hank')).toMatchObject({
      status: 'accepted',
      acceptedByUserId: null,
    });
  });

  it('marks a pending invitation revoked', async () => {
    const w = await acmeWorld();
    await w.fake.revokeInvitation(w.org.externalId, await w.invite('inv-gina', 'gina@x.test', 'member'));
    expect(actions(await w.apply())).toEqual(['invitation:revoked']);
    expect((await w.store.getInvitation('inv-gina'))?.status).toBe('revoked');
  });

  it('ignores an unknown invitation, one of another company and one our row no longer follows', async () => {
    const w = await acmeWorld();
    await w.fake.revokeInvitation(w.org.externalId, await w.invite('inv-gina', 'gina@x.test', 'member'));
    const [revoked] = w.fake.drainEvents() as Event<'invitation.revoked'>[];
    const event = must(revoked);
    const unknown = variant(event, { metadata: {}, externalId: 'orginv_unknown' });
    expect(actions(await project(unknown, w.store, w.ctx))).toEqual([
      'invitation:ignored:unknown_invitation',
    ]);
    const elsewhere = variant(event, { orgExternalId: 'org_other' });
    expect(actions(await project(elsewhere, w.store, w.ctx))).toEqual([
      'invitation:ignored:invitation_other_company',
    ]);
    // Sent again with the same metadata: revoking the first provider invitation leaves ours pending.
    const superseded = variant(event, { externalId: 'orginv_first_send' });
    expect(actions(await project(superseded, w.store, w.ctx))).toEqual([
      'invitation:ignored:other_provider_invitation',
    ]);
    expect((await w.store.getInvitation('inv-gina'))?.status).toBe('pending');
  });

  it.each<[InvitationStatus, 'invitation.accepted' | 'invitation.revoked', string]>([
    ['accepted', 'invitation.accepted', 'invitation:ignored:already_accepted'],
    ['accepted', 'invitation.revoked', 'invitation:ignored:invitation_accepted'],
    ['revoked', 'invitation.revoked', 'invitation:ignored:already_revoked'],
    ['revoked', 'invitation.accepted', 'invitation:refused:invitation_revoked'],
    ['expired', 'invitation.accepted', 'invitation:refused:invitation_expired'],
    ['expired', 'invitation.revoked', 'invitation:ignored:invitation_expired'],
    ['failed', 'invitation.accepted', 'invitation:refused:invitation_failed'],
  ])('keeps an invitation that is %s here on %s (%s)', async (status, type, expected) => {
    const w = await acmeWorld();
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
    const event = {
      provider: 'fake',
      externalEventId: 'evt_1',
      occurredAt: sent.updatedAt + 1,
      type,
      data: { ...sent, status: type === 'invitation.accepted' ? 'accepted' : 'revoked' },
    } as NormalizedIdentityEvent;
    expect(actions(await project(event, w.store, w.ctx))).toEqual([expected]);
    expect((await w.store.getInvitation('inv-bob'))?.status).toBe(status);
  });

  it('learns the provider id even when the invitation is no longer pending', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_ivan', email: 'ivan@x.test' });
    const sent = await w.invite('inv-ivan', 'ivan@x.test', 'member', { knownExternalId: false });
    w.fake.accept(sent, 'u_ivan', { includeInvitationId: false });
    const events = w.fake.drainEvents();
    const accepted = first(events, 'invitation.accepted');
    await applyAll(
      events.filter((e) => e !== accepted),
      w.store,
      w.ctx,
    );
    expect((await w.store.getInvitation('inv-ivan'))?.externalInvitationId).toBeNull();
    const changes = await project(accepted, w.store, w.ctx);
    expect(changes).toMatchObject([
      { action: 'updated', fields: [{ field: 'externalInvitationId', old: null, new: sent }] },
    ]);
    expect(actions(await project(accepted, w.store, w.ctx))).toEqual(['invitation:ignored:already_accepted']);

    // A locally revoked invitation learns it too, and the acceptance is still refused.
    w.store.addInvitation({
      id: 'inv-late',
      companyId: w.company.id,
      email: 'l@x.test',
      role: 'member',
      status: 'revoked',
    });
    const late = variant(accepted, {
      externalId: 'orginv_late',
      metadata: invitationMetadata('inv-late', w.company.id),
    });
    expect(actions(await project(late, w.store, w.ctx))).toEqual([
      'invitation:updated',
      'invitation:refused:invitation_revoked',
    ]);
    expect(await w.store.getInvitation('inv-late')).toMatchObject({
      status: 'revoked',
      externalInvitationId: 'orginv_late',
    });
  });
});
