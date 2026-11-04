import { IdentityProviderError } from '@mwc/identity-core';
import type {
  ExternalInvitation,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IdentityMetadata,
} from '@mwc/shared/identity';
import type {
  ClerkInvitationData,
  ClerkMembershipData,
  ClerkOrganizationData,
  ClerkUserData,
} from './client.ts';

/**
 * Clerk's Backend API objects (SDK resources, camelCase) as identity-core's provider-agnostic shapes.
 * Private metadata is what travels (`mwc_company_id`, `mwc_invitation_id`); emails are lower-cased.
 */

function metadataOf(value: Record<string, unknown> | null | undefined): IdentityMetadata {
  return value ? { ...value } : {};
}

/** The display name Clerk would show: first and last name, else the username, else the email's local part. */
export function displayNameOf(
  firstName: string | null,
  lastName: string | null,
  username: string | null,
  email: string,
): string {
  const full = [firstName, lastName].filter((part) => part && part.trim() !== '').join(' ');
  return full || username || email.split('@')[0] || email;
}

export function toExternalUser(user: ClerkUserData): ExternalUser {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  if (!primary)
    throw new IdentityProviderError('invalid', `clerk: user ${user.id} has no primary email address`);
  const email = primary.emailAddress.toLowerCase();
  return {
    subject: user.id,
    primaryEmail: email,
    displayName: displayNameOf(user.firstName, user.lastName, user.username, email),
    ...(user.hasImage && user.imageUrl ? { imageUrl: user.imageUrl } : {}),
    updatedAt: user.updatedAt,
  };
}

export function toExternalOrg(org: ClerkOrganizationData): ExternalOrg {
  return {
    externalId: org.id,
    name: org.name,
    ...(org.slug ? { slug: org.slug } : {}),
    metadata: metadataOf(org.privateMetadata),
    updatedAt: org.updatedAt,
  };
}

export function toExternalMembership(membership: ClerkMembershipData): ExternalMembership {
  const subject = membership.publicUserData?.userId;
  if (!subject) throw new IdentityProviderError('invalid', `clerk: membership ${membership.id} has no user`);
  return {
    orgExternalId: membership.organization.id,
    subject,
    externalMembershipId: membership.id,
    providerRole: membership.role,
    metadata: metadataOf(membership.privateMetadata),
    updatedAt: membership.updatedAt,
  };
}

export function toExternalInvitation(invitation: ClerkInvitationData): ExternalInvitation {
  return {
    externalId: invitation.id,
    orgExternalId: invitation.organizationId,
    email: invitation.emailAddress.toLowerCase(),
    providerRole: invitation.role,
    // The SDK types the status as optional; an invitation without one has not left "pending".
    status: invitation.status ?? 'pending',
    metadata: metadataOf(invitation.privateMetadata),
    expiresAt: invitation.expiresAt,
    updatedAt: invitation.updatedAt,
  };
}
