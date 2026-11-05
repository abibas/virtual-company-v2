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

/**
 * The person's own name: their first and last name, each trimmed, joined by a space; null when both are empty. Never
 * the username or the email, so a person who has not given a name has none (the web asks them for it).
 */
export function displayNameOf(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const full = [firstName, lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' ');
  return full || null;
}

/**
 * The person's photo: Clerk's `image_url` only when `has_image` says they uploaded one (or brought one from a social
 * sign-in); otherwise the URL is Clerk's generated default, which the web replaces with the person's initials.
 */
export function imageOf(
  hasImage: boolean | null | undefined,
  imageUrl: string | null | undefined,
): { imageUrl?: string } {
  return hasImage && imageUrl ? { imageUrl } : {};
}

export function toExternalUser(user: ClerkUserData): ExternalUser {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  if (!primary)
    throw new IdentityProviderError('invalid', `clerk: user ${user.id} has no primary email address`);
  const email = primary.emailAddress.toLowerCase();
  return {
    subject: user.id,
    primaryEmail: email,
    displayName: displayNameOf(user.firstName, user.lastName),
    ...imageOf(user.hasImage, user.imageUrl),
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
