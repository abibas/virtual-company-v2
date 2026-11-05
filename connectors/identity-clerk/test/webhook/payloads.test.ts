import { describe, expect, it } from 'vitest';
import { bodyOf } from '../../src/webhook.ts';
import { T0 } from '../fixtures/backend.ts';
import { invitationJson, membershipJson, orgJson, userJson } from '../fixtures/payloads.ts';

function invalid(type: string, data: unknown): string {
  try {
    bodyOf(type, data);
  } catch (error) {
    return `${(error as { code: string }).code}: ${(error as Error).message}`;
  }
  throw new Error('expected a refusal');
}

describe('Clerk webhook payloads as normalized events', () => {
  it('user.created and user.updated → user.upserted; user.deleted → user.deleted', () => {
    const user = {
      type: 'user.upserted',
      data: {
        subject: 'user_1',
        primaryEmail: 'ann@x.test',
        displayName: 'Ann',
        imageUrl: 'https://img.clerk.com/ann',
        updatedAt: T0,
      },
    };
    expect(bodyOf('user.created', userJson())).toEqual(user);
    expect(bodyOf('user.updated', userJson())).toEqual(user);
    // No name (a username is not one) and Clerk's generated image: no name and no photo.
    expect(
      bodyOf('user.updated', userJson({ has_image: false, first_name: null, username: 'ann1' })),
    ).toEqual({
      type: 'user.upserted',
      data: { subject: 'user_1', primaryEmail: 'ann@x.test', displayName: null, updatedAt: T0 },
    });
    expect(
      bodyOf('user.updated', userJson({ first_name: ' Ihor ', last_name: 'Herasko ', has_image: null }))
        ?.data,
    ).toEqual({ subject: 'user_1', primaryEmail: 'ann@x.test', displayName: 'Ihor Herasko', updatedAt: T0 });
    expect(bodyOf('user.deleted', { object: 'user', id: 'user_1', deleted: true })).toEqual({
      type: 'user.deleted',
      data: { subject: 'user_1' },
    });
  });

  it('organization.created and .updated → org.upserted with private metadata; .deleted → org.deleted', () => {
    const org = {
      type: 'org.upserted',
      data: {
        externalId: 'org_1',
        name: 'Acme',
        slug: 'acme',
        metadata: { mwc_company_id: 'c1' },
        updatedAt: T0,
      },
    };
    expect(bodyOf('organization.created', orgJson())).toEqual(org);
    expect(bodyOf('organization.updated', orgJson())).toEqual(org);
    expect(bodyOf('organization.updated', orgJson({ slug: null, private_metadata: undefined }))).toEqual({
      type: 'org.upserted',
      data: { externalId: 'org_1', name: 'Acme', metadata: {}, updatedAt: T0 },
    });
    expect(bodyOf('organization.deleted', { object: 'organization', id: 'org_1', deleted: true })).toEqual({
      type: 'org.deleted',
      data: { externalId: 'org_1' },
    });
  });

  it('organizationMembership.* → membership.upserted / membership.deleted', () => {
    const data = {
      orgExternalId: 'org_1',
      subject: 'user_2',
      externalMembershipId: 'orgmem_1',
      providerRole: 'org:member',
      metadata: { mwc_invitation_id: 'inv-1' },
      updatedAt: T0,
    };
    expect(bodyOf('organizationMembership.created', membershipJson())).toEqual({
      type: 'membership.upserted',
      data,
    });
    expect(bodyOf('organizationMembership.updated', membershipJson({ role: 'org:admin' }))).toMatchObject({
      data: { providerRole: 'org:admin' },
    });
    expect(bodyOf('organizationMembership.deleted', membershipJson())).toEqual({
      type: 'membership.deleted',
      data: { orgExternalId: 'org_1', subject: 'user_2', externalMembershipId: 'orgmem_1' },
    });
  });

  it('organizationInvitation.accepted and .revoked → invitation.accepted / invitation.revoked', () => {
    expect(bodyOf('organizationInvitation.accepted', { ...invitationJson(), user_id: 'user_2' })).toEqual({
      type: 'invitation.accepted',
      data: {
        externalId: 'orginv_1',
        orgExternalId: 'org_1',
        email: 'two@x.test',
        providerRole: 'org:member',
        status: 'accepted',
        metadata: { mwc_invitation_id: 'inv-1', mwc_company_id: 'c1' },
        expiresAt: T0 + 14 * 86_400_000,
        updatedAt: T0,
      },
    });
    const revoked = bodyOf(
      'organizationInvitation.revoked',
      invitationJson({ status: 'revoked', expires_at: null }),
    );
    expect(revoked?.data).toMatchObject({ status: 'revoked' });
    expect(revoked?.data).not.toHaveProperty('expiresAt');
    expect(bodyOf('organizationInvitation.revoked', invitationJson({ status: null }))?.data).toMatchObject({
      status: 'pending',
    });
  });

  it('ignores the event types this product does not use', () => {
    for (const type of [
      'organizationInvitation.created',
      'session.created',
      'email.created',
      'role.created',
    ]) {
      expect(bodyOf(type, {})).toBeNull();
    }
  });

  it('refuses payloads that do not fit as invalid, naming the field', () => {
    expect(invalid('user.updated', userJson({ primary_email_address_id: 'idn_9' }))).toBe(
      'invalid: clerk: bad user.updated payload: (data): the user has no primary email address',
    );
    expect(invalid('organizationMembership.created', membershipJson({ public_user_data: {} }))).toMatch(
      /^invalid: clerk: bad organizationMembership.created payload: public_user_data.user_id: /,
    );
    expect(invalid('user.deleted', { deleted: true })).toMatch(/^invalid: .*id: /);
  });
});
