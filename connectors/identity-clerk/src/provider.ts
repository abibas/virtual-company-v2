import {
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type IdentityProvider,
  IdentityProviderError,
  isIdentityProviderError,
  type ProviderCapabilities,
  type UserOrganization,
  type VerifyTokenContext,
  type WebhookRequest,
} from '@mwc/identity-core';
import type {
  ExternalInvitation,
  ExternalInvitationStatus,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IdentityInboxEvent,
  MembershipRole,
  VerifiedIdentity,
} from '@mwc/shared/identity';
import { ClerkCalls } from './backend/calls.ts';
import type { ClerkBackend } from './backend/client.ts';
import {
  toExternalInvitation,
  toExternalMembership,
  toExternalOrg,
  toExternalUser,
} from './backend/mappers.ts';
import { INVITATION_LIMIT, RateGate } from './backend/rate-limit.ts';
import { CLERK_ROLES } from './roles.ts';
import { verifyClerkToken } from './token.ts';
import { parseClerkWebhook } from './webhook.ts';

/** How long an invitation stays valid unless the caller says otherwise. */
export const DEFAULT_INVITATION_DAYS = 14;
/** Items per Backend API page while listing. */
export const PAGE_SIZE = 100;

export interface ClerkIdentityProviderOptions {
  /** The Clerk SDK, or a fake of it in tests. */
  readonly backend: ClerkBackend;
  /** `https://<frontend api host>` (`ClerkConfig.issuer`). */
  readonly issuer: string;
  readonly secretKey: string;
  readonly jwtKey?: string | undefined;
  readonly webhookSigningSecret?: string | undefined;
  /** Milliseconds since the epoch; the rate gate's clock. */
  readonly now?: () => number;
  readonly pageSize?: number;
  readonly invitationLimit?: { count: number; windowMs: number };
}

/**
 * `IdentityProvider` over Clerk's Backend API (`@clerk/backend`), for one Clerk instance. Every failure is
 * an `IdentityProviderError` (backend/errors.ts); a 429 closes the call's bucket for its Retry-After
 * (backend/rate-limit.ts).
 */
export class ClerkIdentityProvider implements IdentityProvider {
  readonly kind = 'clerk';
  readonly issuer: string;
  readonly roles = CLERK_ROLES;
  /** Webhooks only with the endpoint's signing secret: without it no delivery can be verified. */
  readonly capabilities: ProviderCapabilities;

  readonly #backend: ClerkBackend;
  readonly #options: ClerkIdentityProviderOptions;
  readonly #gate: RateGate;
  readonly #api: ClerkCalls;

  constructor(options: ClerkIdentityProviderOptions) {
    this.issuer = options.issuer;
    const webhooks = Boolean(options.webhookSigningSecret);
    this.capabilities = { organizations: true, invitations: true, webhooks, scim: false };
    this.#backend = options.backend;
    this.#options = options;
    this.#gate = new RateGate(options.now ?? Date.now, options.invitationLimit ?? INVITATION_LIMIT);
    this.#api = new ClerkCalls(options.backend.api, this.#gate, options.pageSize ?? PAGE_SIZE);
  }

  verifyAccessToken(token: string, ctx: VerifyTokenContext): Promise<VerifiedIdentity> {
    const { issuer, secretKey, jwtKey } = this.#options;
    return verifyClerkToken(this.#backend.verifyToken, { issuer, secretKey, jwtKey }, token, ctx);
  }

  async getUser(subject: string): Promise<ExternalUser | null> {
    const user = await this.#api.callOrNull('getUser', (api) => api.users.getUser(subject));
    return user === null ? null : toExternalUser(user);
  }

  async listUserOrganizations(subject: string): Promise<UserOrganization[]> {
    const found: UserOrganization[] = [];
    const pages = this.#api.pages('listUserOrganizations', (api, offset, limit) =>
      api.users.getOrganizationMembershipList({ userId: subject, offset, limit }),
    );
    try {
      for await (const membership of pages) {
        found.push({
          org: toExternalOrg(membership.organization),
          membership: toExternalMembership(membership),
        });
      }
    } catch (error) {
      if (isIdentityProviderError(error, 'not_found')) return [];
      throw error;
    }
    return found;
  }

  async createOrganization(input: CreateOrganizationInput): Promise<ExternalOrg> {
    const org = await this.#api.call('createOrganization', (api) =>
      api.organizations.createOrganization({
        name: input.name,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.createdBySubject === undefined ? {} : { createdBy: input.createdBySubject }),
        privateMetadata: { ...input.metadata },
      }),
    );
    return toExternalOrg(org);
  }

  async findOrganizationByMetadata(key: string, value: string): Promise<ExternalOrg | null> {
    // The Backend API cannot search metadata: page through the organizations, newest first (a retry
    // looks for one created moments ago).
    const pages = this.#api.pages('findOrganizationByMetadata', (api, offset, limit) =>
      api.organizations.getOrganizationList({ offset, limit, orderBy: '-created_at' }),
    );
    for await (const org of pages) if (org.privateMetadata?.[key] === value) return toExternalOrg(org);
    return null;
  }

  async deleteOrganization(externalId: string): Promise<void> {
    await this.#api.callOrNull('deleteOrganization', (api) =>
      api.organizations.deleteOrganization(externalId),
    );
  }

  async *listOrganizationMembers(orgExternalId: string): AsyncIterable<ExternalMembership> {
    const pages = this.#api.pages('listOrganizationMembers', (api, offset, limit) =>
      api.organizations.getOrganizationMembershipList({ organizationId: orgExternalId, offset, limit }),
    );
    for await (const membership of pages) yield toExternalMembership(membership);
  }

  async updateMemberRole(
    orgExternalId: string,
    subject: string,
    role: MembershipRole,
  ): Promise<ExternalMembership> {
    const membership = await this.#api.call('updateMemberRole', (api) =>
      api.organizations.updateOrganizationMembership({
        organizationId: orgExternalId,
        userId: subject,
        role: CLERK_ROLES.toProvider(role),
      }),
    );
    return toExternalMembership(membership);
  }

  async removeMember(orgExternalId: string, subject: string): Promise<void> {
    await this.#api.callOrNull('removeMember', (api) =>
      api.organizations.deleteOrganizationMembership({ organizationId: orgExternalId, userId: subject }),
    );
  }

  async createInvitation(input: CreateInvitationInput): Promise<ExternalInvitation> {
    this.#gate.check('invitations');
    this.#gate.takeInvitation();
    const invitation = await this.#api.call(
      'createInvitation',
      (api) =>
        api.organizations.createOrganizationInvitation({
          organizationId: input.orgExternalId,
          emailAddress: input.email,
          role: CLERK_ROLES.toProvider(input.role),
          privateMetadata: { ...input.metadata },
          expiresInDays: input.expiresInDays ?? DEFAULT_INVITATION_DAYS,
          ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
          ...(input.inviterSubject === undefined ? {} : { inviterUserId: input.inviterSubject }),
        }),
      'invitations',
    );
    return toExternalInvitation(invitation);
  }

  async revokeInvitation(orgExternalId: string, invitationExternalId: string): Promise<ExternalInvitation> {
    const params = { organizationId: orgExternalId, invitationId: invitationExternalId };
    const current = toExternalInvitation(
      await this.#api.call('revokeInvitation', (api) => api.organizations.getOrganizationInvitation(params)),
    );
    if (current.status === 'revoked') return current;
    if (current.status !== 'pending') {
      throw new IdentityProviderError(
        'conflict',
        `clerk: invitation ${invitationExternalId} is ${current.status}`,
      );
    }
    return toExternalInvitation(
      await this.#api.call('revokeInvitation', (api) =>
        api.organizations.revokeOrganizationInvitation(params),
      ),
    );
  }

  async listInvitations(
    orgExternalId: string,
    status?: ExternalInvitationStatus,
  ): Promise<ExternalInvitation[]> {
    const found: ExternalInvitation[] = [];
    const pages = this.#api.pages('listInvitations', (api, offset, limit) =>
      api.organizations.getOrganizationInvitationList({
        organizationId: orgExternalId,
        offset,
        limit,
        ...(status === undefined ? {} : { status: [status] }),
      }),
    );
    for await (const invitation of pages) found.push(toExternalInvitation(invitation));
    return found;
  }

  parseWebhook(request: WebhookRequest): Promise<IdentityInboxEvent | null> {
    return parseClerkWebhook(this.#backend.verifyWebhook, this.#options.webhookSigningSecret, request);
  }
}
