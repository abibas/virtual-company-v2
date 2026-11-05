import { project } from '@mwc/identity-core';
import { InMemoryIdentityStore } from '@mwc/identity-core/memory-store';
import { describe, expect, it } from 'vitest';
import {
  displayNameOf,
  imageOf,
  toExternalInvitation,
  toExternalMembership,
  toExternalOrg,
  toExternalUser,
} from '../../src/backend/mappers.ts';
import { CLERK_ROLES } from '../../src/roles.ts';
import { clerkInvitation, clerkMembership, clerkOrg, clerkUser, ISSUER, T0 } from '../fixtures/backend.ts';

/**
 * The invitee's membership as the Backend API listed it after a ticket sign-up in the first real-Clerk run
 * (2026-11-04): Clerk copies the invitation's private metadata onto the membership, and carries no invitation id.
 * Ids are made up; the fields and their kinds are what the SDK object had (organization slugs off: Clerk still gives
 * the organization a generated slug).
 */
const realMembership = {
  id: 'orgmem_3LeqLLh1zirPCFJawCQefZYWMtP',
  role: 'org:member',
  permissions: ['org:sys_memberships:read'],
  publicMetadata: {},
  privateMetadata: { mwc_company_id: 'company-1', mwc_invitation_id: 'invitation-1' },
  createdAt: T0,
  updatedAt: T0,
  organization: {
    id: 'org_3LeqL1wDeAVvODedJlmXUP63BYM',
    name: 'Acme',
    slug: 'acme-1793824743983946338',
    privateMetadata: { mwc_company_id: 'company-1' },
    updatedAt: T0 - 1000,
  },
  publicUserData: { userId: 'user_3LeqLW', identifier: 'two+clerk_test@example.com', firstName: null },
};

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

  it("maps a person who gave no name and has Clerk's default image: no name, no photo", () => {
    const nameless = clerkUser({ firstName: null, lastName: '  ', username: 'ann1', hasImage: false });
    expect(toExternalUser(nameless)).toEqual({
      subject: 'user_1',
      primaryEmail: 'ann@x.test',
      displayName: null,
      updatedAt: T0,
    });
    expect(toExternalUser(clerkUser({ hasImage: true, imageUrl: '' }))).not.toHaveProperty('imageUrl');
  });

  it('refuses a user without a primary email address as invalid', () => {
    expect(() => toExternalUser(clerkUser({ primaryEmailAddressId: null }))).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
  });

  it('names a person by their first and last name, trimmed, and nothing else', () => {
    expect(displayNameOf('Ihor', 'Herasko')).toBe('Ihor Herasko');
    expect(displayNameOf('  Ihor ', ' Herasko  ')).toBe('Ihor Herasko');
    expect(displayNameOf('Ann', null)).toBe('Ann');
    expect(displayNameOf(undefined, 'Lee')).toBe('Lee');
    expect(displayNameOf(' ', '')).toBeNull();
    expect(displayNameOf(null, undefined)).toBeNull();
  });

  it('takes the image only when Clerk says the person has one of their own', () => {
    expect(imageOf(true, 'https://img.clerk.com/me')).toEqual({ imageUrl: 'https://img.clerk.com/me' });
    expect(imageOf(false, 'https://img.clerk.com/default')).toEqual({});
    expect(imageOf(null, 'https://img.clerk.com/default')).toEqual({});
    expect(imageOf(true, '')).toEqual({});
    expect(imageOf(undefined, undefined)).toEqual({});
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

  it('maps a membership as Clerk returns it for an accepted invitation, and the projector links it to ours', async () => {
    const membership = toExternalMembership(realMembership);
    expect(membership).toEqual({
      orgExternalId: 'org_3LeqL1wDeAVvODedJlmXUP63BYM',
      subject: 'user_3LeqLW',
      externalMembershipId: 'orgmem_3LeqLLh1zirPCFJawCQefZYWMtP',
      providerRole: 'org:member',
      metadata: { mwc_company_id: 'company-1', mwc_invitation_id: 'invitation-1' },
      updatedAt: T0,
    });
    // The S1.7 projector links it by `mwc_invitation_id`: the invitation turns accepted, the person active.
    const store = new InMemoryIdentityStore();
    const company = store.addCompany({ id: 'company-1', identityOrgExternalId: membership.orgExternalId });
    const user = store.addUser({
      issuer: ISSUER,
      subject: 'user_3LeqLW',
      primaryEmail: 'two+clerk_test@example.com',
      displayName: 'Two',
    });
    store.addInvitation({
      id: 'invitation-1',
      companyId: company.id,
      email: 'two+clerk_test@example.com',
      role: 'member',
    });
    const event = {
      provider: 'clerk',
      externalEventId: 'evt_1',
      occurredAt: T0,
      type: 'membership.upserted' as const,
      data: membership,
    };
    const changes = await project(event, store, { issuer: ISSUER, roles: CLERK_ROLES });
    expect(changes.map((c) => `${c.entity} ${c.action}`)).toEqual([
      'invitation accepted',
      'membership created',
    ]);
    expect(await store.getMembership(company.id, user.id)).toMatchObject({
      role: 'member',
      status: 'active',
      invitationId: 'invitation-1',
      externalMembershipId: membership.externalMembershipId,
    });
    expect(await store.getInvitation('invitation-1')).toMatchObject({
      status: 'accepted',
      acceptedByUserId: user.id,
    });
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
