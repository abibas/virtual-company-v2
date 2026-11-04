import { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { IdentityProviderError } from '../src/errors.ts';
import { FAKE_ISSUER, FAKE_ROLES, FakeIdentityProvider, type FakeMethod } from '../src/fake.ts';
import type { IdentityProvider } from '../src/provider.ts';
import { collect, ctx, populated, providerError, sampleEvent } from './fixtures/provider.ts';
import { buildScenario, T0, world } from './fixtures/world.ts';

describe('FakeIdentityProvider: identity', () => {
  it('describes itself like a provider with organizations, invitations and webhooks', () => {
    const fake = new FakeIdentityProvider();
    expect(fake.kind).toBe('fake');
    expect(fake.issuer).toBe(FAKE_ISSUER);
    expect(fake.roles).toBe(FAKE_ROLES);
    expect(fake.capabilities).toEqual({
      organizations: true,
      invitations: true,
      webhooks: true,
      scim: false,
    });
    expect(new FakeIdentityProvider({ issuer: 'https://other' }).issuer).toBe('https://other');
  });

  it('maps roles the way Clerk default roles do', () => {
    expect(['owner', 'admin', 'member', 'viewer'].map((r) => FAKE_ROLES.toProvider(r as never))).toEqual([
      'org:admin',
      'org:admin',
      'org:member',
      'org:member',
    ]);
    expect([
      FAKE_ROLES.isAdmin('org:admin'),
      FAKE_ROLES.isAdmin('org:member'),
      FAKE_ROLES.isAdmin('admin'),
    ]).toEqual([true, false, false]);
  });
});

describe('FakeIdentityProvider: users', () => {
  it('signs people up, updates and deletes them', async () => {
    const { fake } = world();
    const user = fake.createUser({ email: 'Ann@X.Test', imageUrl: 'https://i/a.png' });
    expect(user).toEqual({
      subject: expect.stringMatching(/^user_\d+$/),
      primaryEmail: 'ann@x.test',
      displayName: 'ann',
      imageUrl: 'https://i/a.png',
      updatedAt: T0,
    });
    expect(await fake.getUser(user.subject)).toEqual(user);
    const updated = fake.updateUser(user.subject, {
      email: 'A@Y.test',
      displayName: 'Ann',
      imageUrl: 'https://i/b',
    });
    expect(updated).toMatchObject({ primaryEmail: 'a@y.test', displayName: 'Ann', imageUrl: 'https://i/b' });
    expect(updated.updatedAt).toBeGreaterThan(user.updatedAt);
    expect(fake.updateUser(user.subject, {})).toMatchObject({ primaryEmail: 'a@y.test', displayName: 'Ann' });
    fake.deleteUser(user.subject);
    expect(await fake.getUser(user.subject)).toBeNull();
  });

  it('refuses a subject taken now or before, and changes to an unknown user', async () => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    expect((await providerError(() => fake.createUser({ subject: 'u1', email: 'x@x.test' }))).code).toBe(
      'conflict',
    );
    fake.deleteUser('u1');
    expect((await providerError(() => fake.createUser({ subject: 'u1', email: 'x@x.test' }))).code).toBe(
      'conflict',
    );
    expect((await providerError(() => fake.updateUser('u404', {}))).code).toBe('not_found');
    expect((await providerError(() => fake.deleteUser('u404'))).code).toBe('not_found');
  });

  it('removes a deleted user from their organizations first', async () => {
    const { fake, org } = await populated();
    fake.deleteUser('u1');
    expect(fake.drainEvents().map((e) => e.type)).toEqual(['membership.deleted', 'user.deleted']);
    expect(await collect(fake.listOrganizationMembers(org.externalId))).toEqual([]);
    expect(await fake.listUserOrganizations('u1')).toEqual([]);
  });
});

describe('FakeIdentityProvider: organizations', () => {
  it('creates an organization with its creator as an admin member', async () => {
    const { fake, org } = await populated();
    expect(org).toEqual({
      externalId: expect.stringMatching(/^org_\d+$/),
      name: 'Acme',
      slug: 'acme',
      metadata: { mwc_company_id: 'c1' },
      updatedAt: expect.any(Number),
    });
    const members = await collect(fake.listOrganizationMembers(org.externalId));
    expect(members).toMatchObject([
      { orgExternalId: org.externalId, subject: 'u1', providerRole: 'org:admin', metadata: {} },
    ]);
    expect(await fake.listUserOrganizations('u1')).toEqual([{ org, membership: members[0] }]);
    expect(await fake.listUserOrganizations('u2')).toEqual([]);
    const bare = await fake.createOrganization({ name: 'Bare', metadata: {} });
    expect(bare.slug).toBeUndefined();
    expect(await collect(fake.listOrganizationMembers(bare.externalId))).toEqual([]);
  });

  it('refuses a taken slug and an unknown creator', async () => {
    const { fake } = await populated();
    expect(
      (await providerError(() => fake.createOrganization({ name: 'B', slug: 'acme', metadata: {} }))).code,
    ).toBe('conflict');
    const unknownCreator = () =>
      fake.createOrganization({ name: 'B', metadata: {}, createdBySubject: 'u404' });
    expect((await providerError(unknownCreator)).code).toBe('not_found');
  });

  it('finds an organization by its metadata', async () => {
    const { fake, org } = await populated();
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c1')).toEqual(org);
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c2')).toBeNull();
  });

  it('deletes an organization with its members and invitations, idempotently', async () => {
    const { fake, org } = await populated();
    await fake.deleteOrganization(org.externalId);
    await fake.deleteOrganization(org.externalId);
    expect(fake.drainEvents()).toMatchObject([{ type: 'org.deleted', data: { externalId: org.externalId } }]);
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c1')).toBeNull();
    expect((await providerError(() => fake.listInvitations(org.externalId))).code).toBe('not_found');
    expect(await fake.listUserOrganizations('u1')).toEqual([]);
  });

  it('lists members as an AsyncIterable that rejects on iteration for an unknown organization', async () => {
    const { fake } = await populated();
    const listing = fake.listOrganizationMembers('org_404');
    expect(typeof listing[Symbol.asyncIterator]).toBe('function');
    expect((await providerError(() => collect(listing))).code).toBe('not_found');
  });
});

describe('FakeIdentityProvider: members', () => {
  it('changes a role once (the same role again is no change) and refuses a non-member', async () => {
    const { fake, org } = await populated();
    const [before] = await collect(fake.listOrganizationMembers(org.externalId));
    expect(await fake.updateMemberRole(org.externalId, 'u1', 'owner')).toEqual(before);
    const demoted = await fake.updateMemberRole(org.externalId, 'u1', 'viewer');
    expect(demoted).toMatchObject({
      providerRole: 'org:member',
      externalMembershipId: before?.externalMembershipId,
    });
    expect(fake.drainEvents()).toMatchObject([{ type: 'membership.upserted', data: demoted }]);
    expect((await providerError(() => fake.updateMemberRole(org.externalId, 'u2', 'admin'))).code).toBe(
      'not_found',
    );
    expect((await providerError(() => fake.updateMemberRole('org_404', 'u1', 'admin'))).code).toBe(
      'not_found',
    );
  });

  it('removes a member idempotently', async () => {
    const { fake, org } = await populated();
    await fake.removeMember(org.externalId, 'u1');
    await fake.removeMember(org.externalId, 'u1');
    await fake.removeMember('org_404', 'u1');
    expect(fake.drainEvents()).toMatchObject([
      { type: 'membership.deleted', data: { orgExternalId: org.externalId, subject: 'u1' } },
    ]);
  });

  it('adds a member from its dashboard, without an invitation', async () => {
    const { fake, org } = await populated();
    expect(fake.addMember(org.externalId, 'u2', 'org:member')).toMatchObject({ metadata: {}, subject: 'u2' });
    expect((await providerError(() => fake.addMember(org.externalId, 'u2', 'org:admin'))).code).toBe(
      'conflict',
    );
    expect((await providerError(() => fake.addMember('org_404', 'u2', 'org:admin'))).code).toBe('not_found');
    expect((await providerError(() => fake.addMember(org.externalId, 'u404', 'org:admin'))).code).toBe(
      'not_found',
    );
  });
});

describe('FakeIdentityProvider: invitations', () => {
  it('sends an invitation with the mapped role, its metadata and an expiry', async () => {
    const { fake, org, invitation } = await populated();
    expect(invitation).toEqual({
      externalId: expect.stringMatching(/^orginv_\d+$/),
      orgExternalId: org.externalId,
      email: 'two@x.test',
      providerRole: 'org:member',
      status: 'pending',
      metadata: { mwc_invitation_id: 'inv-1' },
      expiresAt: invitation.updatedAt + 30 * 24 * 60 * 60 * 1000,
      updatedAt: expect.any(Number),
    });
    const short = await fake.createInvitation({
      orgExternalId: org.externalId,
      email: 'Three@X.test',
      role: 'admin',
      metadata: {},
      expiresInDays: 14,
      redirectUrl: 'http://localhost:9951/accept-invitation',
    });
    expect(short).toMatchObject({ email: 'three@x.test', providerRole: 'org:admin' });
    expect(short.expiresAt).toBe(short.updatedAt + 14 * 24 * 60 * 60 * 1000);
    // Sending an invitation is not one of the normalized events.
    expect(fake.drainEvents()).toEqual([]);
  });

  it('refuses a second pending invitation, an invitation for a member and an unknown organization', async () => {
    const { fake, org } = await populated();
    const again = (email: string, orgExternalId = org.externalId) =>
      providerError(() => fake.createInvitation({ orgExternalId, email, role: 'member', metadata: {} }));
    expect((await again('TWO@x.test')).code).toBe('conflict');
    expect((await again('one@x.test')).code).toBe('conflict');
    expect((await again('new@x.test', 'org_404')).code).toBe('not_found');
  });

  it('revokes a pending invitation once and refuses to revoke an accepted one', async () => {
    const { fake, org, invitation } = await populated();
    const revoked = await fake.revokeInvitation(org.externalId, invitation.externalId);
    expect(revoked).toMatchObject({ status: 'revoked' });
    expect(await fake.revokeInvitation(org.externalId, invitation.externalId)).toEqual(revoked);
    expect(fake.drainEvents()).toMatchObject([{ type: 'invitation.revoked', data: revoked }]);
    expect((await providerError(() => fake.revokeInvitation(org.externalId, 'orginv_404'))).code).toBe(
      'not_found',
    );
    expect((await providerError(() => fake.revokeInvitation('org_404', invitation.externalId))).code).toBe(
      'not_found',
    );
    const other = await fake.createInvitation({
      orgExternalId: org.externalId,
      email: 'two@x.test',
      role: 'member',
      metadata: {},
    });
    fake.accept(other.externalId, 'u2');
    expect((await providerError(() => fake.revokeInvitation(org.externalId, other.externalId))).code).toBe(
      'conflict',
    );
  });

  it('lists invitations, optionally of one status', async () => {
    const { fake, org, invitation } = await populated();
    const second = await fake.createInvitation({
      orgExternalId: org.externalId,
      email: 'z@x.test',
      role: 'viewer',
      metadata: {},
    });
    await fake.revokeInvitation(org.externalId, second.externalId);
    expect((await fake.listInvitations(org.externalId)).map((i) => i.externalId)).toEqual([
      invitation.externalId,
      second.externalId,
    ]);
    expect((await fake.listInvitations(org.externalId, 'pending')).map((i) => i.externalId)).toEqual([
      invitation.externalId,
    ]);
    expect(await fake.listInvitations(org.externalId, 'expired')).toEqual([]);
    expect((await providerError(() => fake.listInvitations('org_404'))).code).toBe('not_found');
  });
});

describe('FakeIdentityProvider: accept', () => {
  it('turns the invitation accepted and makes a membership carrying its metadata and id', async () => {
    const { fake, org, invitation } = await populated();
    const membership = fake.accept(invitation.externalId, 'u2');
    expect(membership).toEqual({
      orgExternalId: org.externalId,
      subject: 'u2',
      externalMembershipId: expect.stringMatching(/^orgmem_\d+$/),
      providerRole: 'org:member',
      metadata: { mwc_invitation_id: 'inv-1' },
      externalInvitationId: invitation.externalId,
      updatedAt: expect.any(Number),
    });
    expect(membership.metadata).not.toBe(invitation.metadata);
    expect(fake.drainEvents()).toMatchObject([
      { type: 'invitation.accepted', data: { externalId: invitation.externalId, status: 'accepted' } },
      { type: 'membership.upserted', data: membership },
    ]);
    expect((await fake.listInvitations(org.externalId, 'accepted')).length).toBe(1);
  });

  it('can leave the metadata or the invitation id off the membership', async () => {
    const { fake, invitation } = await populated();
    const membership = fake.accept(invitation.externalId, 'u2', {
      copyMetadata: false,
      includeInvitationId: false,
    });
    expect(membership.metadata).toEqual({});
    expect('externalInvitationId' in membership).toBe(false);
  });

  it('refuses an unknown invitation, one not pending, an unknown user and a member', async () => {
    const { fake, org, invitation } = await populated();
    expect((await providerError(() => fake.accept('orginv_404', 'u2'))).code).toBe('not_found');
    expect((await providerError(() => fake.accept(invitation.externalId, 'u404'))).code).toBe('not_found');
    const forMember = await fake.createInvitation({
      orgExternalId: org.externalId,
      email: 'x@x.test',
      role: 'member',
      metadata: {},
    });
    expect((await providerError(() => fake.accept(forMember.externalId, 'u1'))).code).toBe('conflict');
    fake.accept(invitation.externalId, 'u2');
    expect((await providerError(() => fake.accept(invitation.externalId, 'u2'))).code).toBe('conflict');
  });
});

describe('FakeIdentityProvider: events', () => {
  it('emits every change as a valid normalized event with unique ids and strictly increasing times', async () => {
    const { fake, events } = await buildScenario();
    expect(fake.drainEvents()).toEqual([]);
    expect(new Set(events.map((e) => e.externalEventId)).size).toBe(events.length);
    for (const event of events) expect(NormalizedIdentityEvent.parse(event)).toEqual(event);
    const times = events.map((e) => e.occurredAt);
    expect(times[0]).toBe(T0);
    expect(times.every((t, i) => i === 0 || t > (times[i - 1] ?? 0))).toBe(true);
    expect(events.every((e) => e.provider === 'fake')).toBe(true);
  });

  it('keeps times increasing when the clock goes back, and follows it when it moves on', () => {
    let now = T0;
    const fake = new FakeIdentityProvider({ clock: () => new Date(now) });
    fake.createUser({ subject: 'a', email: 'a@x.test' });
    now = T0 - 60_000;
    fake.createUser({ subject: 'b', email: 'b@x.test' });
    now = T0 + 60_000;
    fake.createUser({ subject: 'c', email: 'c@x.test' });
    expect(fake.drainEvents().map((e) => e.occurredAt)).toEqual([T0, T0 + 1, T0 + 60_000]);
  });

  it('empties the queue on drain', () => {
    const fake = new FakeIdentityProvider();
    fake.createUser({ subject: 'a', email: 'a@x.test' });
    expect(fake.drainEvents()).toHaveLength(1);
    expect(fake.drainEvents()).toEqual([]);
  });
});

describe('FakeIdentityProvider: failNext', () => {
  /** One call of every IdentityProvider method that succeeds on the populated provider. */
  const calls: [
    FakeMethod,
    (fake: IdentityProvider, ids: { org: string; inv: string }) => Promise<unknown>,
  ][] = [
    ['verifyAccessToken', (f) => f.verifyAccessToken('fake:u1', ctx)],
    ['getUser', (f) => f.getUser('u1')],
    ['listUserOrganizations', (f) => f.listUserOrganizations('u1')],
    ['createOrganization', (f) => f.createOrganization({ name: 'B', metadata: {} })],
    ['findOrganizationByMetadata', (f) => f.findOrganizationByMetadata('k', 'v')],
    ['deleteOrganization', (f) => f.deleteOrganization('org_404')],
    ['listOrganizationMembers', (f, ids) => collect(f.listOrganizationMembers(ids.org))],
    ['updateMemberRole', (f, ids) => f.updateMemberRole(ids.org, 'u1', 'admin')],
    ['removeMember', (f, ids) => f.removeMember(ids.org, 'u404')],
    [
      'createInvitation',
      (f, ids) =>
        f.createInvitation({ orgExternalId: ids.org, email: 'n@x.test', role: 'member', metadata: {} }),
    ],
    ['revokeInvitation', (f, ids) => f.revokeInvitation(ids.org, ids.inv)],
    ['listInvitations', (f, ids) => f.listInvitations(ids.org)],
    ['parseWebhook', (f) => f.parseWebhook((f as FakeIdentityProvider).webhookFor(sampleEvent))],
  ];

  it.each(calls)('makes the next %s fail exactly once', async (method, call) => {
    const { fake, org, invitation } = await populated();
    const ids = { org: org.externalId, inv: invitation.externalId };
    fake.failNext(method);
    const error = await providerError(() => call(fake, ids));
    expect(error).toMatchObject({ code: 'unavailable', message: `fake: ${method} failed`, retryable: true });
    // Only that call failed: the same call now goes through.
    await call(fake, ids);
  });

  it('queues failures per method and rejects with the error given', async () => {
    const fake = new FakeIdentityProvider();
    const limited = new IdentityProviderError('rate_limited', 'slow down', { retryAfterMs: 1500 });
    fake.failNext('getUser', limited);
    fake.failNext('getUser');
    await expect(fake.getUser('x')).rejects.toBe(limited);
    expect((await providerError(() => fake.getUser('x'))).code).toBe('unavailable');
    expect(await fake.getUser('x')).toBeNull();
    expect(await fake.listUserOrganizations('x')).toEqual([]);
  });
});
