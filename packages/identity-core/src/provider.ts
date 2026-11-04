import type {
  ExternalInvitation,
  ExternalInvitationStatus,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IdentityMetadata,
  MembershipRole,
  NormalizedIdentityEvent,
  VerifiedIdentity,
} from '@mwc/shared/identity';

/**
 * What a provider can do. Clerk: organizations, invitations and webhooks; a future OIDC/SCIM provider:
 * no organizations or invitations (companies stay local), `scim` for inbound user sync.
 */
export interface ProviderCapabilities {
  readonly organizations: boolean;
  readonly invitations: boolean;
  readonly webhooks: boolean;
  readonly scim: boolean;
}

/**
 * How a provider's own role names relate to ours. Each provider ships one (S1.2: Clerk's `org:admin` and
 * `org:member`); identity-core only consumes it.
 */
export interface ProviderRoleMap {
  /** The provider role to send for a local role (invitations, role updates). */
  toProvider(role: MembershipRole): string;
  /** True for a provider role that means "administrator": an inbound change to it promotes to admin. */
  isAdmin(providerRole: string): boolean;
}

export interface VerifyTokenContext {
  /** Origins a token may be issued to (Clerk `azp`): the web origin(s). */
  readonly authorizedParties: readonly string[];
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly slug?: string;
  /** Private metadata; carries `mwc_company_id` so a retry can find the organization again. */
  readonly metadata: IdentityMetadata;
  /** Made the organization's first (admin) member by the provider, as Clerk's `createdBy` does. */
  readonly createdBySubject?: string;
}

export interface CreateInvitationInput {
  readonly orgExternalId: string;
  readonly email: string;
  /** Our role; the provider maps it with its `roles.toProvider`. */
  readonly role: MembershipRole;
  /** Private metadata copied onto the membership on accept: `mwc_invitation_id`, `mwc_company_id`. */
  readonly metadata: IdentityMetadata;
  /** Where the emailed link lands (`/accept-invitation`). */
  readonly redirectUrl?: string;
  readonly expiresInDays?: number;
  readonly inviterSubject?: string;
}

/** A webhook delivery as received: header names lower-case, the body exactly as sent (signatures cover it). */
export interface WebhookRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly rawBody: string;
}

export interface UserOrganization {
  readonly org: ExternalOrg;
  readonly membership: ExternalMembership;
}

/**
 * The provider-agnostic identity provider (docs/architecture.md, "Identity flow"). Implementations:
 * `FakeIdentityProvider` (tests), the Clerk provider (S1.2), an OIDC/SCIM provider later.
 *
 * Contract for every method: failures reject with `IdentityProviderError` (`code` not_found | conflict |
 * rate_limited with `retryAfterMs` | unauthorized | invalid | unavailable); never with a raw SDK or
 * network error. Lookups answer null for "does not exist"; mutations of something that does not exist
 * reject with `not_found`, except the removals, which are idempotent so outbox retries converge.
 * Nothing here decides access: local memberships do (the projector writes them).
 */
export interface IdentityProvider {
  /** `clerk`, `fake`, ...: stored as `companies.identity_provider` and on every normalized event. */
  readonly kind: string;
  /** The issuer of the provider's tokens; users are keyed by `(issuer, subject)`. */
  readonly issuer: string;
  readonly roles: ProviderRoleMap;
  readonly capabilities: ProviderCapabilities;

  /**
   * Verifies a session token (signature, issuer, expiry, authorized party) and returns who it is.
   * Rejects with `unauthorized` for any token that does not verify. A session with a pending task
   * verifies with `pending: true`; the caller decides where that is allowed.
   */
  verifyAccessToken(token: string, ctx: VerifyTokenContext): Promise<VerifiedIdentity>;

  /** The user, or null when there is none (or it was deleted). */
  getUser(subject: string): Promise<ExternalUser | null>;

  /** Every organization the user is a member of, with that membership (for reconcile-on-sign-in). */
  listUserOrganizations(subject: string): Promise<UserOrganization[]>;

  /**
   * Creates an organization. Not idempotent by itself: before retrying after an unknown outcome, look
   * for it with `findOrganizationByMetadata('mwc_company_id', companyId)`. Rejects with `conflict`
   * for a slug that is taken.
   */
  createOrganization(input: CreateOrganizationInput): Promise<ExternalOrg>;

  /** The first organization whose private metadata has `key === value`, or null. */
  findOrganizationByMetadata(key: string, value: string): Promise<ExternalOrg | null>;

  /** Deletes an organization; deleting one that does not exist resolves (idempotent). */
  deleteOrganization(externalId: string): Promise<void>;

  /**
   * Every member of an organization, paging internally. Rejects (on iteration) with `not_found` for an
   * unknown organization.
   */
  listOrganizationMembers(orgExternalId: string): AsyncIterable<ExternalMembership>;

  /**
   * Sets a member's role (mapped with `roles.toProvider`); setting the role it already has changes
   * nothing. Rejects with `not_found` when the person is not a member.
   */
  updateMemberRole(orgExternalId: string, subject: string, role: MembershipRole): Promise<ExternalMembership>;

  /** Removes a member; removing someone who is not a member resolves (idempotent). */
  removeMember(orgExternalId: string, subject: string): Promise<void>;

  /**
   * Sends an invitation. Rejects with `conflict` when a pending invitation for that email exists or the
   * email is already a member, `not_found` for an unknown organization, `rate_limited` (Clerk: 250 an
   * hour) with `retryAfterMs`.
   */
  createInvitation(input: CreateInvitationInput): Promise<ExternalInvitation>;

  /**
   * Revokes a pending invitation; revoking one already revoked returns it (idempotent). Rejects with
   * `conflict` when it was accepted or expired, `not_found` when there is no such invitation.
   */
  revokeInvitation(orgExternalId: string, invitationExternalId: string): Promise<ExternalInvitation>;

  /** The organization's invitations, optionally of one status. */
  listInvitations(orgExternalId: string, status?: ExternalInvitationStatus): Promise<ExternalInvitation[]>;

  /**
   * Verifies a webhook delivery's signature and normalizes it. Rejects with `unauthorized` for a
   * missing or bad signature and `invalid` for a body that does not parse; resolves null for an event
   * type this product does not use (the caller acknowledges and drops it).
   */
  parseWebhook(request: WebhookRequest): Promise<NormalizedIdentityEvent | null>;
}
