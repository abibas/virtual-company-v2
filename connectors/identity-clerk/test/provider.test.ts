import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_INVITATION_DAYS } from '../src/provider.ts';
import {
  apiError,
  clerkInvitation,
  clerkMembership,
  clerkOrg,
  clerkUser,
  clerkWorld,
  ISSUER,
  page,
  SECRET_KEY,
} from './fixtures/backend.ts';

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'resolved';
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

describe('ClerkIdentityProvider: identity', () => {
  it('is the clerk provider of one instance, with organizations, invitations and webhooks', () => {
    const { provider } = clerkWorld({ webhookSigningSecret: 'whsec_x' });
    expect(provider.kind).toBe('clerk');
    expect(provider.issuer).toBe(ISSUER);
    expect(provider.roles.toProvider('owner')).toBe('org:admin');
    expect(provider.capabilities).toEqual({
      organizations: true,
      invitations: true,
      webhooks: true,
      scim: false,
    });
    expect(clerkWorld().provider.capabilities.webhooks).toBe(false);
  });

  it('verifies tokens with its keys and the caller’s authorized parties', async () => {
    const { provider, backend } = clerkWorld({ jwtKey: 'pem' });
    vi.mocked(backend.verifyToken).mockResolvedValue({ iss: ISSUER, sub: 'user_1', sid: 'sess_1' });
    expect(await provider.verifyAccessToken('t', { authorizedParties: ['http://localhost:9951'] })).toEqual({
      issuer: ISSUER,
      subject: 'user_1',
      sessionId: 'sess_1',
      pending: false,
    });
    expect(backend.verifyToken).toHaveBeenCalledWith('t', {
      jwtKey: 'pem',
      issuer: ISSUER,
      authorizedParties: ['http://localhost:9951'],
      clockSkewInMs: 5_000,
    });
  });

  it('parses webhooks with its signing secret', async () => {
    const { provider, backend } = clerkWorld({ webhookSigningSecret: 'whsec_x' });
    vi.mocked(backend.verifyWebhook).mockResolvedValue({ type: 'user.deleted', data: { id: 'user_1' } });
    const event = await provider.parseWebhook({
      headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1' },
      rawBody: '{}',
    });
    expect(event?.type).toBe('user.deleted');
    expect(vi.mocked(backend.verifyWebhook).mock.calls[0]?.[1]).toEqual({ signingSecret: 'whsec_x' });
    expect(await code(clerkWorld().provider.parseWebhook({ headers: {}, rawBody: '{}' }))).toBe(
      'unavailable',
    );
  });
});

describe('ClerkIdentityProvider: users', () => {
  it('gets a user, null for a 404, and maps other failures', async () => {
    const { provider, api } = clerkWorld();
    api.users.getUser.mockResolvedValueOnce(clerkUser());
    expect(await provider.getUser('user_1')).toMatchObject({ subject: 'user_1', primaryEmail: 'ann@x.test' });
    expect(api.users.getUser).toHaveBeenCalledWith('user_1');
    api.users.getUser.mockRejectedValueOnce(apiError(404, 'resource_not_found'));
    expect(await provider.getUser('user_x')).toBeNull();
    api.users.getUser.mockRejectedValueOnce(apiError(401, 'authentication_invalid'));
    expect(await code(provider.getUser('user_1'))).toBe('unauthorized');
  });

  it("lists a user's organizations across pages, and none for an unknown user", async () => {
    const { provider, api } = clerkWorld({ pageSize: 1 });
    const second = clerkMembership({ id: 'orgmem_2', organization: clerkOrg({ id: 'org_2', name: 'Beta' }) });
    api.users.getOrganizationMembershipList
      .mockResolvedValueOnce(page([clerkMembership()], 2))
      .mockResolvedValueOnce(page([second], 2));
    const found = await provider.listUserOrganizations('user_1');
    expect(found.map((entry) => [entry.org.externalId, entry.membership.externalMembershipId])).toEqual([
      ['org_1', 'orgmem_1'],
      ['org_2', 'orgmem_2'],
    ]);
    expect(api.users.getOrganizationMembershipList).toHaveBeenLastCalledWith({
      userId: 'user_1',
      offset: 1,
      limit: 1,
    });
    api.users.getOrganizationMembershipList.mockRejectedValueOnce(apiError(404));
    expect(await provider.listUserOrganizations('user_x')).toEqual([]);
    api.users.getOrganizationMembershipList.mockRejectedValueOnce(apiError(502));
    expect(await code(provider.listUserOrganizations('user_1'))).toBe('unavailable');
  });
});

describe('ClerkIdentityProvider: organizations', () => {
  it('creates one with the company id in private metadata and the creator as admin', async () => {
    const { provider, api } = clerkWorld();
    api.organizations.createOrganization.mockResolvedValue(clerkOrg());
    const org = await provider.createOrganization({
      name: 'Acme',
      slug: 'acme',
      metadata: { mwc_company_id: 'c1' },
      createdBySubject: 'user_1',
    });
    expect(org).toMatchObject({ externalId: 'org_1', metadata: { mwc_company_id: 'c1' } });
    expect(api.organizations.createOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      slug: 'acme',
      createdBy: 'user_1',
      privateMetadata: { mwc_company_id: 'c1' },
    });
    await provider.createOrganization({ name: 'Bare', metadata: {} });
    expect(api.organizations.createOrganization).toHaveBeenLastCalledWith({
      name: 'Bare',
      privateMetadata: {},
    });
    api.organizations.createOrganization.mockRejectedValueOnce(apiError(422, 'form_identifier_exists'));
    expect(await code(provider.createOrganization({ name: 'Acme', slug: 'acme', metadata: {} }))).toBe(
      'conflict',
    );
  });

  it('finds one by private metadata, newest first across pages, or null', async () => {
    const { provider, api } = clerkWorld({ pageSize: 1 });
    api.organizations.getOrganizationList
      .mockResolvedValueOnce(page([clerkOrg({ id: 'org_9', privateMetadata: null })], 2))
      .mockResolvedValueOnce(page([clerkOrg()], 2));
    expect((await provider.findOrganizationByMetadata('mwc_company_id', 'c1'))?.externalId).toBe('org_1');
    expect(api.organizations.getOrganizationList).toHaveBeenCalledWith({
      offset: 0,
      limit: 1,
      orderBy: '-created_at',
    });
    api.organizations.getOrganizationList.mockResolvedValueOnce(page([clerkOrg()], 1));
    expect(await provider.findOrganizationByMetadata('mwc_company_id', 'c2')).toBeNull();
  });

  it('deletes idempotently: a 404 resolves, other failures reject', async () => {
    const { provider, api } = clerkWorld();
    api.organizations.deleteOrganization.mockResolvedValueOnce({}).mockRejectedValueOnce(apiError(404));
    await provider.deleteOrganization('org_1');
    await provider.deleteOrganization('org_1');
    expect(api.organizations.deleteOrganization).toHaveBeenCalledWith('org_1');
    api.organizations.deleteOrganization.mockRejectedValueOnce(apiError(500));
    expect(await code(provider.deleteOrganization('org_1'))).toBe('unavailable');
  });
});

describe('ClerkIdentityProvider: members', () => {
  it('lists members page by page; an unknown organization rejects as not_found on iteration', async () => {
    const { provider, api } = clerkWorld({ pageSize: 1 });
    const second = clerkMembership({ id: 'orgmem_2', publicUserData: { userId: 'user_2' } });
    api.organizations.getOrganizationMembershipList
      .mockResolvedValueOnce(page([clerkMembership()], 2))
      .mockResolvedValueOnce(page([second], 2));
    expect((await collect(provider.listOrganizationMembers('org_1'))).map((m) => m.subject)).toEqual([
      'user_1',
      'user_2',
    ]);
    expect(api.organizations.getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: 'org_1',
      offset: 0,
      limit: 1,
    });
    api.organizations.getOrganizationMembershipList.mockRejectedValueOnce(apiError(404));
    expect(await code(collect(provider.listOrganizationMembers('org_x')))).toBe('not_found');
  });

  it("updates a member's role with the mapped Clerk role; a non-member is not_found", async () => {
    const { provider, api } = clerkWorld();
    api.organizations.updateOrganizationMembership.mockResolvedValue(clerkMembership({ role: 'org:admin' }));
    expect((await provider.updateMemberRole('org_1', 'user_1', 'owner')).providerRole).toBe('org:admin');
    expect(api.organizations.updateOrganizationMembership).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'org:admin',
    });
    await provider.updateMemberRole('org_1', 'user_1', 'viewer');
    expect(api.organizations.updateOrganizationMembership).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'org:member' }),
    );
    api.organizations.updateOrganizationMembership.mockRejectedValueOnce(apiError(404));
    expect(await code(provider.updateMemberRole('org_1', 'user_x', 'admin'))).toBe('not_found');
  });

  it('removes a member idempotently', async () => {
    const { provider, api } = clerkWorld();
    api.organizations.deleteOrganizationMembership
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(apiError(404));
    await provider.removeMember('org_1', 'user_1');
    await provider.removeMember('org_1', 'user_1');
    expect(api.organizations.deleteOrganizationMembership).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'user_1',
    });
  });
});

describe('ClerkIdentityProvider: invitations', () => {
  it('creates one with our metadata, the mapped role, the redirect and a 14-day expiry by default', async () => {
    const { provider, api } = clerkWorld();
    api.organizations.createOrganizationInvitation.mockResolvedValue(clerkInvitation());
    const metadata = { mwc_invitation_id: 'inv-1', mwc_company_id: 'c1' };
    const invitation = await provider.createInvitation({
      orgExternalId: 'org_1',
      email: 'Two@X.Test',
      role: 'viewer',
      metadata,
      redirectUrl: 'http://localhost:9951/accept-invitation',
      inviterSubject: 'user_1',
    });
    expect(invitation).toMatchObject({ externalId: 'orginv_1', email: 'two@x.test', metadata });
    expect(api.organizations.createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'org_1',
      emailAddress: 'Two@X.Test',
      role: 'org:member',
      privateMetadata: metadata,
      expiresInDays: DEFAULT_INVITATION_DAYS,
      redirectUrl: 'http://localhost:9951/accept-invitation',
      inviterUserId: 'user_1',
    });
    expect(DEFAULT_INVITATION_DAYS).toBe(14);
    await provider.createInvitation({
      orgExternalId: 'org_1',
      email: 'a@x.test',
      role: 'admin',
      metadata: {},
      expiresInDays: 3,
    });
    expect(api.organizations.createOrganizationInvitation).toHaveBeenLastCalledWith({
      organizationId: 'org_1',
      emailAddress: 'a@x.test',
      role: 'org:admin',
      privateMetadata: {},
      expiresInDays: 3,
    });
  });

  it('honors a 429 on invitations: refused locally until Retry-After passes', async () => {
    const { provider, api, advance } = clerkWorld();
    const input = { orgExternalId: 'org_1', email: 'a@x.test', role: 'member' as const, metadata: {} };
    api.organizations.createOrganizationInvitation
      .mockRejectedValueOnce(apiError(429, 'too_many_requests', 30))
      .mockResolvedValue(clerkInvitation());
    expect(await code(provider.createInvitation(input))).toBe('rate_limited');
    expect(await code(provider.createInvitation(input))).toBe('rate_limited');
    expect(api.organizations.createOrganizationInvitation).toHaveBeenCalledTimes(1);
    api.users.getUser.mockResolvedValue(clerkUser());
    expect(await provider.getUser('user_1')).not.toBeNull();
    advance(30_000);
    expect((await provider.createInvitation(input)).externalId).toBe('orginv_1');
  });

  it('keeps to the invitation budget of the hour without calling Clerk', async () => {
    const { provider, api, advance } = clerkWorld({ invitationLimit: { count: 2, windowMs: 60_000 } });
    api.organizations.createOrganizationInvitation.mockResolvedValue(clerkInvitation());
    const input = { orgExternalId: 'org_1', email: 'a@x.test', role: 'member' as const, metadata: {} };
    await provider.createInvitation(input);
    await provider.createInvitation(input);
    expect(await code(provider.createInvitation(input))).toBe('rate_limited');
    expect(api.organizations.createOrganizationInvitation).toHaveBeenCalledTimes(2);
    advance(60_000);
    await provider.createInvitation(input);
  });

  it('revokes a pending one, returns a revoked one as it is, refuses an accepted one', async () => {
    const { provider, api } = clerkWorld();
    const params = { organizationId: 'org_1', invitationId: 'orginv_1' };
    api.organizations.getOrganizationInvitation.mockResolvedValueOnce(clerkInvitation());
    api.organizations.revokeOrganizationInvitation.mockResolvedValueOnce(
      clerkInvitation({ status: 'revoked' }),
    );
    expect((await provider.revokeInvitation('org_1', 'orginv_1')).status).toBe('revoked');
    expect(api.organizations.revokeOrganizationInvitation).toHaveBeenCalledWith(params);
    api.organizations.getOrganizationInvitation.mockResolvedValueOnce(clerkInvitation({ status: 'revoked' }));
    expect((await provider.revokeInvitation('org_1', 'orginv_1')).status).toBe('revoked');
    api.organizations.getOrganizationInvitation.mockResolvedValueOnce(
      clerkInvitation({ status: 'accepted' }),
    );
    expect(await code(provider.revokeInvitation('org_1', 'orginv_1'))).toBe('conflict');
    expect(api.organizations.revokeOrganizationInvitation).toHaveBeenCalledTimes(1);
    api.organizations.getOrganizationInvitation.mockRejectedValueOnce(apiError(404));
    expect(await code(provider.revokeInvitation('org_1', 'orginv_x'))).toBe('not_found');
  });

  it('lists all invitations or those of one status, across pages', async () => {
    const { provider, api } = clerkWorld({ pageSize: 1 });
    api.organizations.getOrganizationInvitationList
      .mockResolvedValueOnce(page([clerkInvitation()], 2))
      .mockResolvedValueOnce(page([clerkInvitation({ id: 'orginv_2', status: 'accepted' })], 2));
    expect((await provider.listInvitations('org_1')).map((i) => i.status)).toEqual(['pending', 'accepted']);
    expect(api.organizations.getOrganizationInvitationList).toHaveBeenCalledWith({
      organizationId: 'org_1',
      offset: 0,
      limit: 1,
    });
    api.organizations.getOrganizationInvitationList.mockResolvedValueOnce(page([clerkInvitation()], 1));
    await provider.listInvitations('org_1', 'pending');
    expect(api.organizations.getOrganizationInvitationList).toHaveBeenLastCalledWith({
      organizationId: 'org_1',
      offset: 0,
      limit: 1,
      status: ['pending'],
    });
  });
});

describe('ClerkIdentityProvider: options', () => {
  it('works with the default clock and page size', async () => {
    const { provider, api } = clerkWorld({ now: undefined as never, pageSize: undefined as never });
    api.organizations.getOrganizationInvitationList.mockResolvedValue(page([]));
    expect(await provider.listInvitations('org_1')).toEqual([]);
    expect(api.organizations.getOrganizationInvitationList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
    expect(SECRET_KEY).toMatch(/^sk_test_/);
  });
});
