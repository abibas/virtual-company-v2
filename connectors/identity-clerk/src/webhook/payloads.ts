import type {
  ExternalInvitation,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IdentityMetadata,
} from '@mwc/shared/identity';
import { z } from 'zod';
import { displayNameOf } from '../backend/mappers.ts';

/**
 * The parts of Clerk's webhook payloads (snake_case JSON, as the Backend API sends them) that become
 * normalized events. Each schema reads only what it needs; anything else in the payload is ignored.
 */

const Metadata = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((value): IdentityMetadata => ({ ...(value ?? {}) }));

const OrganizationJson = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().nullish(),
  private_metadata: Metadata,
  updated_at: z.number().int().nonnegative(),
});

export const UserPayload = z
  .object({
    id: z.string().min(1),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    username: z.string().nullish(),
    image_url: z.string().nullish(),
    has_image: z.boolean().nullish(),
    primary_email_address_id: z.string().nullish(),
    email_addresses: z.array(z.object({ id: z.string(), email_address: z.string() })),
    updated_at: z.number().int().nonnegative(),
  })
  .transform((user, ctx): ExternalUser => {
    const primary = user.email_addresses.find((address) => address.id === user.primary_email_address_id);
    if (!primary) {
      ctx.addIssue({ code: 'custom', message: 'the user has no primary email address' });
      return z.NEVER;
    }
    const email = primary.email_address.toLowerCase();
    return {
      subject: user.id,
      primaryEmail: email,
      displayName: displayNameOf(
        user.first_name ?? null,
        user.last_name ?? null,
        user.username ?? null,
        email,
      ),
      ...(user.has_image && user.image_url ? { imageUrl: user.image_url } : {}),
      updatedAt: user.updated_at,
    };
  });

export const OrganizationPayload = OrganizationJson.transform(
  (org): ExternalOrg => ({
    externalId: org.id,
    name: org.name,
    ...(org.slug ? { slug: org.slug } : {}),
    metadata: org.private_metadata,
    updatedAt: org.updated_at,
  }),
);

export const MembershipPayload = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    private_metadata: Metadata,
    updated_at: z.number().int().nonnegative(),
    organization: z.object({ id: z.string().min(1) }),
    public_user_data: z.object({ user_id: z.string().min(1) }),
  })
  .transform(
    (membership): ExternalMembership => ({
      orgExternalId: membership.organization.id,
      subject: membership.public_user_data.user_id,
      externalMembershipId: membership.id,
      providerRole: membership.role,
      metadata: membership.private_metadata,
      updatedAt: membership.updated_at,
    }),
  );

export const InvitationPayload = z
  .object({
    id: z.string().min(1),
    email_address: z.string(),
    role: z.string().min(1),
    organization_id: z.string().min(1),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']).nullish(),
    private_metadata: Metadata,
    expires_at: z.number().int().nonnegative().nullish(),
    updated_at: z.number().int().nonnegative(),
  })
  .transform(
    (invitation): ExternalInvitation => ({
      externalId: invitation.id,
      orgExternalId: invitation.organization_id,
      email: invitation.email_address.toLowerCase(),
      providerRole: invitation.role,
      status: invitation.status ?? 'pending',
      metadata: invitation.private_metadata,
      ...(invitation.expires_at == null ? {} : { expiresAt: invitation.expires_at }),
      updatedAt: invitation.updated_at,
    }),
  );

/** `user.deleted` and `organization.deleted` carry only the deleted object's id. */
export const DeletedPayload = z.object({ id: z.string().min(1) });
