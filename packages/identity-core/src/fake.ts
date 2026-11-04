import type {
  ExternalInvitation,
  ExternalInvitationStatus,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IdentityInboxEvent,
  MembershipRole,
  NormalizedIdentityEvent,
  VerifiedIdentity,
} from '@mwc/shared/identity';
import { IdentityProviderError } from './errors.ts';
import { createFakeInvitation, listFakeInvitations, revokeFakeInvitation } from './fake/invitations.ts';
import { createFakeOrganization, deleteFakeOrganization } from './fake/organizations.ts';
import { verifyFakeToken } from './fake/tokens.ts';
import { fakeWebhookFor, parseFakeWebhook } from './fake/webhooks.ts';
import { type AcceptOptions, type FakeUserInput, FakeWorld } from './fake/world.ts';
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
  IdentityProvider,
  ProviderRoleMap,
  UserOrganization,
  VerifyTokenContext,
  WebhookRequest,
} from './provider.ts';

export { FAKE_CLOCK_SKEW_MS, type FakeToken, parseFakeToken } from './fake/tokens.ts';
export { FAKE_SIGNATURE_HEADER } from './fake/webhooks.ts';
export type { AcceptOptions, FakeUserInput } from './fake/world.ts';

export const FAKE_ISSUER = 'https://identity.fake.mwc.test';
const DEFAULT_SECRET = 'fake-webhook-secret';
/** What the fake can do; organization slugs are an option (`organizationSlugs`). */
const FAKE_CAPABILITIES = { organizations: true, invitations: true, webhooks: true, scim: false } as const;

/** Clerk's two default roles: owners and admins are `org:admin`, members and viewers `org:member`. */
export const FAKE_ROLES: ProviderRoleMap = {
  toProvider: (role) => (role === 'owner' || role === 'admin' ? 'org:admin' : 'org:member'),
  isAdmin: (providerRole) => providerRole === 'org:admin',
};

/** The provider methods `failNext` can make fail. */
export type FakeMethod = {
  [K in keyof IdentityProvider]: IdentityProvider[K] extends (...args: never[]) => unknown ? K : never;
}[keyof IdentityProvider];

export interface FakeIdentityProviderOptions {
  readonly issuer?: string;
  /** Where times come from; event times stay strictly increasing (1 ms apart while the clock stands still). */
  readonly clock?: () => Date;
  /** The key `webhookFor` signs with and `parseWebhook` checks. */
  readonly webhookSecret?: string;
  /** Keep organization slugs, refusing a taken one; off by default (the slug is ignored), like the Clerk connector. */
  readonly organizationSlugs?: boolean;
}

/**
 * An in-memory `IdentityProvider` that behaves like Clerk where S1 depends on it: users, organizations,
 * memberships and invitations; `fake:<subject>[;org=<externalId>][;pending]` tokens (with optional `sid`,
 * `iss`, `azp`, `exp` and `nbf` parts checked like Clerk's claims, `fake/tokens.ts`); `accept()` as the
 * invitee accepting (the membership gets the invitation's metadata); every change emitted as a
 * normalized event (`drainEvents()`), and signed as a webhook by `webhookFor()`; `failNext()` for
 * retry tests. The helpers that are not part of `IdentityProvider` (createUser, accept, ...) are
 * synchronous and play the user or the provider's dashboard.
 */
export class FakeIdentityProvider implements IdentityProvider {
  readonly kind = 'fake';
  readonly issuer: string;
  readonly roles = FAKE_ROLES;
  readonly capabilities: IdentityProvider['capabilities'];

  readonly #world: FakeWorld;
  readonly #secret: string;
  readonly #failures = new Map<FakeMethod, Error[]>();

  constructor(options: FakeIdentityProviderOptions = {}) {
    this.issuer = options.issuer ?? FAKE_ISSUER;
    this.capabilities = { ...FAKE_CAPABILITIES, organizationSlugs: options.organizationSlugs ?? false };
    this.#world = new FakeWorld(this.kind, options.clock ?? (() => new Date()));
    this.#secret = options.webhookSecret ?? DEFAULT_SECRET;
  }

  // --- test controls ---------------------------------------------------------------------------

  /** Makes the next call of `method` reject with `error` (an `unavailable` error by default); calls queue. */
  failNext(
    method: FakeMethod,
    error: Error = new IdentityProviderError('unavailable', `fake: ${method} failed`),
  ): void {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
  }

  /** The events emitted since the last drain, oldest first, with strictly increasing `occurredAt`. */
  drainEvents(): NormalizedIdentityEvent[] {
    return this.#world.drainEvents();
  }

  /**
   * The event as a signed webhook delivery that `parseWebhook` accepts; any other JSON object is signed as it is (a
   * delivery of a type this product does not use, such as `{ ...event, type: 'session.created' }`).
   */
  webhookFor(event: NormalizedIdentityEvent | Readonly<Record<string, unknown>>): WebhookRequest {
    return fakeWebhookFor(event, this.#secret);
  }

  /** A person signs up. */
  createUser(input: FakeUserInput): ExternalUser {
    return this.#world.createUser(input);
  }

  /** A person changes their profile. */
  updateUser(
    subject: string,
    patch: { email?: string; displayName?: string; imageUrl?: string },
  ): ExternalUser {
    return this.#world.updateUser(subject, patch);
  }

  /** The account is deleted: its memberships go first (each emitted), then the user. */
  deleteUser(subject: string): void {
    this.#world.deleteUser(subject);
  }

  /**
   * The invitee accepts: the invitation turns accepted and a membership with the invitation's role
   * appears, carrying its metadata (and its id) unless told otherwise.
   */
  accept(invitationExternalId: string, subject: string, options: AcceptOptions = {}): ExternalMembership {
    return this.#world.accept(invitationExternalId, subject, options);
  }

  /** Someone adds a member directly in the provider (its dashboard), without an invitation. */
  addMember(orgExternalId: string, subject: string, providerRole: string): ExternalMembership {
    return this.#world.addMember(orgExternalId, subject, providerRole);
  }

  // --- IdentityProvider --------------------------------------------------------------------------

  /** `fake:<subject>` tokens with optional parts (`fake/tokens.ts`), checked like a Clerk session token. */
  async verifyAccessToken(token: string, ctx: VerifyTokenContext): Promise<VerifiedIdentity> {
    this.#maybeFail('verifyAccessToken');
    const users = this.#world.users;
    return verifyFakeToken(token, ctx, {
      issuer: this.issuer,
      now: this.#world.now(),
      exists: (subject) => users.has(subject),
    });
  }

  async getUser(subject: string): Promise<ExternalUser | null> {
    this.#maybeFail('getUser');
    return this.#world.users.get(subject) ?? null;
  }

  async listUserOrganizations(subject: string): Promise<UserOrganization[]> {
    this.#maybeFail('listUserOrganizations');
    const found: UserOrganization[] = [];
    for (const [orgId, members] of this.#world.members) {
      const membership = members.get(subject);
      if (membership) found.push({ org: this.#world.org(orgId), membership });
    }
    return found;
  }

  async createOrganization(input: CreateOrganizationInput): Promise<ExternalOrg> {
    this.#maybeFail('createOrganization');
    return createFakeOrganization(this.#world, input, FAKE_ROLES.toProvider('admin'), this.capabilities);
  }

  async findOrganizationByMetadata(key: string, value: string): Promise<ExternalOrg | null> {
    this.#maybeFail('findOrganizationByMetadata');
    return [...this.#world.orgs.values()].find((org) => org.metadata[key] === value) ?? null;
  }

  async deleteOrganization(externalId: string): Promise<void> {
    this.#maybeFail('deleteOrganization');
    deleteFakeOrganization(this.#world, externalId);
  }

  async *listOrganizationMembers(orgExternalId: string): AsyncIterable<ExternalMembership> {
    this.#maybeFail('listOrganizationMembers');
    this.#world.org(orgExternalId);
    yield* [...(this.#world.members.get(orgExternalId)?.values() ?? [])];
  }

  async updateMemberRole(
    orgExternalId: string,
    subject: string,
    role: MembershipRole,
  ): Promise<ExternalMembership> {
    this.#maybeFail('updateMemberRole');
    const membership = this.#world.members.get(orgExternalId)?.get(subject);
    if (!membership)
      throw new IdentityProviderError('not_found', `fake: ${subject} is not a member of ${orgExternalId}`);
    const providerRole = FAKE_ROLES.toProvider(role);
    if (membership.providerRole === providerRole) return membership;
    const updated: ExternalMembership = { ...membership, providerRole, updatedAt: this.#world.tick() };
    this.#world.members.get(orgExternalId)?.set(subject, updated);
    this.#world.emit({ type: 'membership.upserted', data: updated }, updated.updatedAt);
    return updated;
  }

  async removeMember(orgExternalId: string, subject: string): Promise<void> {
    this.#maybeFail('removeMember');
    if (this.#world.members.get(orgExternalId)?.has(subject))
      this.#world.removeMembership(orgExternalId, subject);
  }

  async createInvitation(input: CreateInvitationInput): Promise<ExternalInvitation> {
    this.#maybeFail('createInvitation');
    return createFakeInvitation(this.#world, input, FAKE_ROLES.toProvider(input.role));
  }

  async revokeInvitation(orgExternalId: string, invitationExternalId: string): Promise<ExternalInvitation> {
    this.#maybeFail('revokeInvitation');
    return revokeFakeInvitation(this.#world, orgExternalId, invitationExternalId);
  }

  async listInvitations(
    orgExternalId: string,
    status?: ExternalInvitationStatus,
  ): Promise<ExternalInvitation[]> {
    this.#maybeFail('listInvitations');
    return listFakeInvitations(this.#world, orgExternalId, status);
  }

  async parseWebhook(request: WebhookRequest): Promise<IdentityInboxEvent | null> {
    this.#maybeFail('parseWebhook');
    return parseFakeWebhook(request, this.#secret);
  }

  // --- internals ---------------------------------------------------------------------------------

  #maybeFail(method: FakeMethod): void {
    const error = this.#failures.get(method)?.shift();
    if (error) throw error;
  }
}
