import { describe, expect, it } from 'vitest';
import {
  displayNameOf,
  toExternalInvitation,
  toExternalMembership,
  toExternalOrg,
  toExternalUser,
} from '../../src/backend/mappers.ts';
import { clerkInvitation, clerkMembership, clerkOrg, clerkUser, T0 } from '../fixtures/backend.ts';

describe('Backend API objects as identity-core shapes', () => {
  it('maps a user: the primary email lower-cased, the full name, the image only when set', () => {
    expect(toExternalUser(clerkUser())).toEqual({
      subject: 'user_1',
      primaryEmail: 'ann@x.test',
      displayName: 'Ann Lee',
      imageUrl: 'https://img.clerk.com/ann',
      updatedAt: T0,
    });
    expect(toExternalUser(clerkUser({ hasImage: false }))).not.toHaveProperty('imageUrl');
  });

  it('refuses a user without a primary email address as invalid', () => {
    expect(() => toExternalUser(clerkUser({ primaryEmailAddressId: null }))).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
  });

  it('names a person by full name, else username, else the email', () => {
    expect(displayNameOf('Ann', null, 'ann1', 'a@x.test')).toBe('Ann');
    expect(displayNameOf(' ', '', 'ann1', 'a@x.test')).toBe('ann1');
    expect(displayNameOf(null, null, null, 'a@x.test')).toBe('a');
    expect(displayNameOf(null, null, null, '@x.test')).toBe('@x.test');
  });

  it('maps an organization with its private metadata', () => {
    expect(toExternalOrg(clerkOrg())).toEqual({
      externalId: 'org_1',
      name: 'Acme',
      slug: 'acme',
      metadata: { mwc_company_id: 'c1' },
      updatedAt: T0,
    });
    const bare = toExternalOrg(clerkOrg({ slug: null, privateMetadata: null }));
    expect(bare).not.toHaveProperty('slug');
    expect(bare.metadata).toEqual({});
  });

  it('maps a membership with the metadata its invitation carried', () => {
    expect(toExternalMembership(clerkMembership())).toEqual({
      orgExternalId: 'org_1',
      subject: 'user_1',
      externalMembershipId: 'orgmem_1',
      providerRole: 'org:member',
      metadata: { mwc_invitation_id: 'inv-1' },
      updatedAt: T0,
    });
    expect(toExternalMembership(clerkMembership({ privateMetadata: null })).metadata).toEqual({});
    expect(() => toExternalMembership(clerkMembership({ publicUserData: null }))).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
  });

  it('maps an invitation; one without a status is pending', () => {
    expect(toExternalInvitation(clerkInvitation())).toEqual({
      externalId: 'orginv_1',
      orgExternalId: 'org_1',
      email: 'two@x.test',
      providerRole: 'org:member',
      status: 'pending',
      metadata: { mwc_invitation_id: 'inv-1', mwc_company_id: 'c1' },
      expiresAt: T0 + 14 * 86_400_000,
      updatedAt: T0,
    });
    expect(toExternalInvitation(clerkInvitation({ status: undefined, privateMetadata: null }))).toMatchObject(
      {
        status: 'pending',
        metadata: {},
      },
    );
    expect(toExternalInvitation(clerkInvitation({ status: 'revoked' })).status).toBe('revoked');
  });
});
