import { describe, expect, it } from 'vitest';
import { populated, providerError } from '../fixtures/provider.ts';

// FakeIdentityProvider's invitations (src/fake/invitations.ts), through the provider.
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
