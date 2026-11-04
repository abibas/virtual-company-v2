import { z } from 'zod';

/**
 * The provider-agnostic identity contracts (docs/architecture.md, "Identity flow"). An identity provider
 * (Clerk in S1.2, OIDC/SCIM later) turns its own objects and webhooks into these shapes, and
 * `@mwc/identity-core` projects them into local users, memberships and invitations. Times are
 * milliseconds since the epoch: JSON-safe, exact, and what Clerk sends as `updated_at`.
 */

/** `memberships.role`: what a person may do in one company. Only a local decision makes an owner. */
export const MembershipRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MembershipRole = z.infer<typeof MembershipRole>;

/** `memberships.status`: `removed` ends access at once and is never undone by the provider alone. */
export const MembershipStatus = z.enum(['invited', 'active', 'suspended', 'removed']);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

/** `invitations.status`; `failed` is local only (the provider never accepted the invitation). */
export const InvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired', 'failed']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

/** Milliseconds since the epoch. */
export const EpochMs = z.number().int().nonnegative();

/** Provider-side metadata (Clerk's private metadata): where `mwc_invitation_id` and `mwc_company_id` travel. */
export const IdentityMetadata = z.record(z.string(), z.unknown());
export type IdentityMetadata = z.infer<typeof IdentityMetadata>;

/** A verified access token. Identity is `(issuer, subject)`, never an email. */
export const VerifiedIdentity = z.object({
  issuer: z.string().min(1),
  subject: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  /** The session still has a pending task (Clerk `sts=pending`); only `/api/me` accepts it. */
  pending: z.boolean(),
  /** The organization active in the session: a hint for the UI, never used for authorization. */
  activeOrgExternalId: z.string().min(1).optional(),
});
export type VerifiedIdentity = z.infer<typeof VerifiedIdentity>;

export const ExternalUser = z.object({
  subject: z.string().min(1),
  primaryEmail: z.email(),
  displayName: z.string(),
  imageUrl: z.url().optional(),
  updatedAt: EpochMs,
});
export type ExternalUser = z.infer<typeof ExternalUser>;

export const ExternalOrg = z.object({
  externalId: z.string().min(1),
  name: z.string(),
  slug: z.string().optional(),
  metadata: IdentityMetadata,
  updatedAt: EpochMs,
});
export type ExternalOrg = z.infer<typeof ExternalOrg>;

export const ExternalMembership = z.object({
  orgExternalId: z.string().min(1),
  subject: z.string().min(1),
  externalMembershipId: z.string().min(1),
  /** The provider's own role name (Clerk `org:admin`); the provider's role map reads it. */
  providerRole: z.string().min(1),
  /** Copied from the invitation when the person accepted it (holds `mwc_invitation_id`). */
  metadata: IdentityMetadata,
  /** The provider invitation this membership came from, when the provider says so. */
  externalInvitationId: z.string().min(1).optional(),
  updatedAt: EpochMs,
});
export type ExternalMembership = z.infer<typeof ExternalMembership>;

/** The statuses a provider invitation can have (`failed` is ours only). */
export const ExternalInvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type ExternalInvitationStatus = z.infer<typeof ExternalInvitationStatus>;

export const ExternalInvitation = z.object({
  externalId: z.string().min(1),
  orgExternalId: z.string().min(1),
  email: z.email(),
  providerRole: z.string().min(1),
  status: ExternalInvitationStatus,
  metadata: IdentityMetadata,
  expiresAt: EpochMs.optional(),
  updatedAt: EpochMs,
});
export type ExternalInvitation = z.infer<typeof ExternalInvitation>;

/** Every normalized event type; a provider resolves anything else to null (ignored). */
export const IDENTITY_EVENT_TYPES = [
  'user.upserted',
  'user.deleted',
  'org.upserted',
  'org.deleted',
  'membership.upserted',
  'membership.deleted',
  'invitation.accepted',
  'invitation.revoked',
] as const;

const eventBase = {
  /** The provider kind that produced the event (`clerk`, `fake`). */
  provider: z.string().min(1),
  /** The provider's id for this delivery (svix id); S1.3 dedupes on `(provider, externalEventId)`. */
  externalEventId: z.string().min(1),
  occurredAt: EpochMs,
};

/** Every identity change, from any provider, webhook or reconcile, in one shape. */
export const NormalizedIdentityEvent = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('user.upserted'), data: ExternalUser }),
  z.object({ ...eventBase, type: z.literal('user.deleted'), data: z.object({ subject: z.string().min(1) }) }),
  z.object({ ...eventBase, type: z.literal('org.upserted'), data: ExternalOrg }),
  z.object({
    ...eventBase,
    type: z.literal('org.deleted'),
    data: z.object({ externalId: z.string().min(1) }),
  }),
  z.object({ ...eventBase, type: z.literal('membership.upserted'), data: ExternalMembership }),
  z.object({
    ...eventBase,
    type: z.literal('membership.deleted'),
    data: z.object({
      orgExternalId: z.string().min(1),
      subject: z.string().min(1),
      externalMembershipId: z.string().min(1),
    }),
  }),
  z.object({ ...eventBase, type: z.literal('invitation.accepted'), data: ExternalInvitation }),
  z.object({ ...eventBase, type: z.literal('invitation.revoked'), data: ExternalInvitation }),
]);
export type NormalizedIdentityEvent = z.infer<typeof NormalizedIdentityEvent>;
export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

/** Metadata keys this product writes to the provider and reads back. */
export const IDENTITY_METADATA = {
  /** On an invitation (copied onto the membership on accept): the local invitation id. */
  invitationId: 'mwc_invitation_id',
  /** On an organization and an invitation: the local company id. */
  companyId: 'mwc_company_id',
} as const;
