import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type ExternalInvitation,
  type ExternalInvitationStatus,
  type ExternalMembership,
  type ExternalOrg,
  type ExternalUser,
  IDENTITY_EVENT_TYPES,
  type MembershipRole,
  NormalizedIdentityEvent,
  type VerifiedIdentity,
} from '@mwc/shared/identity';
import { IdentityProviderError } from './errors.ts';
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
  IdentityProvider,
  ProviderRoleMap,
  UserOrganization,
  VerifyTokenContext,
  WebhookRequest,
} from './provider.ts';

export const FAKE_ISSUER = 'https://identity.fake.mwc.test';
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
const DEFAULT_SECRET = 'fake-webhook-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

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
}

export interface FakeUserInput {
  readonly subject?: string;
  readonly email: string;
  readonly displayName?: string;
  readonly imageUrl?: string;
}

export interface AcceptOptions {
  /** Copy the invitation's private metadata onto the membership, as Clerk does; default true. */
  readonly copyMetadata?: boolean;
  /** Put the invitation's id on the membership (`externalInvitationId`); default true. */
  readonly includeInvitationId?: boolean;
}

type EventBody = NormalizedIdentityEvent extends infer E
  ? E extends NormalizedIdentityEvent
    ? Pick<E, 'type' | 'data'>
    : never
  : never;

const KNOWN_TYPES: ReadonlySet<string> = new Set(IDENTITY_EVENT_TYPES);

/**
 * An in-memory `IdentityProvider` that behaves like Clerk where S1 depends on it: users, organizations,
 * memberships and invitations; `fake:<subject>[;org=<externalId>][;pending]` tokens; `accept()` as the
 * invitee accepting (the membership gets the invitation's metadata); every change emitted as a
 * normalized event (`drainEvents()`), and signed as a webhook by `webhookFor()`; `failNext()` for
 * retry tests. The helpers that are not part of `IdentityProvider` (createUser, accept, ...) are
 * synchronous and play the user or the provider's dashboard.
 */
export class FakeIdentityProvider implements IdentityProvider {
  readonly kind = 'fake';
  readonly issuer: string;
  readonly roles = FAKE_ROLES;
  readonly capabilities = { organizations: true, invitations: true, webhooks: true, scim: false } as const;

  readonly #clock: () => Date;
  readonly #secret: string;
  #lastTime = 0;
  #counter = 0;
  #events: NormalizedIdentityEvent[] = [];
  readonly #users = new Map<string, ExternalUser>();
  readonly #deletedUsers = new Set<string>();
  readonly #orgs = new Map<string, ExternalOrg>();
  /** Organization → subject → membership. */
  readonly #members = new Map<string, Map<string, ExternalMembership>>();
  readonly #invitations = new Map<string, ExternalInvitation>();
  readonly #failures = new Map<FakeMethod, Error[]>();

  constructor(options: FakeIdentityProviderOptions = {}) {
    this.issuer = options.issuer ?? FAKE_ISSUER;
    this.#clock = options.clock ?? (() => new Date());
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
    const events = this.#events;
    this.#events = [];
    return events;
  }

  /** The event as a signed webhook delivery that `parseWebhook` accepts. */
  webhookFor(event: NormalizedIdentityEvent): WebhookRequest {
    const rawBody = JSON.stringify(event);
    return {
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: this.#sign(rawBody) },
      rawBody,
    };
  }

  /** A person signs up. */
  createUser(input: FakeUserInput): ExternalUser {
    const subject = input.subject ?? this.#id('user');
    if (this.#users.has(subject) || this.#deletedUsers.has(subject))
      throw new IdentityProviderError('conflict', `fake: user ${subject} exists`);
    const email = input.email.toLowerCase();
    const user: ExternalUser = {
      subject,
      primaryEmail: email,
      displayName: input.displayName ?? email.split('@')[0] ?? email,
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
      updatedAt: this.#tick(),
    };
    this.#users.set(subject, user);
    this.#emit({ type: 'user.upserted', data: user }, user.updatedAt);
    return user;
  }

  /** A person changes their profile. */
  updateUser(
    subject: string,
    patch: { email?: string; displayName?: string; imageUrl?: string },
  ): ExternalUser {
    const user = this.#user(subject);
    const updated: ExternalUser = {
      ...user,
      ...(patch.email === undefined ? {} : { primaryEmail: patch.email.toLowerCase() }),
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.imageUrl === undefined ? {} : { imageUrl: patch.imageUrl }),
      updatedAt: this.#tick(),
    };
    this.#users.set(subject, updated);
    this.#emit({ type: 'user.upserted', data: updated }, updated.updatedAt);
    return updated;
  }

  /** The account is deleted: its memberships go first (each emitted), then the user. */
  deleteUser(subject: string): void {
    this.#user(subject);
    for (const [orgId, members] of this.#members)
      if (members.has(subject)) this.#removeMember(orgId, subject);
    this.#users.delete(subject);
    this.#deletedUsers.add(subject);
    this.#emit({ type: 'user.deleted', data: { subject } }, this.#tick());
  }

  /**
   * The invitee accepts: the invitation turns accepted and a membership with the invitation's role
   * appears, carrying its metadata (and its id) unless told otherwise.
   */
  accept(invitationExternalId: string, subject: string, options: AcceptOptions = {}): ExternalMembership {
    const invitation = this.#invitations.get(invitationExternalId);
    if (!invitation)
      throw new IdentityProviderError('not_found', `fake: no invitation ${invitationExternalId}`);
    if (invitation.status !== 'pending')
      throw new IdentityProviderError('conflict', `fake: invitation is ${invitation.status}`);
    this.#user(subject);
    if (this.#members.get(invitation.orgExternalId)?.has(subject))
      throw new IdentityProviderError('conflict', 'fake: already a member');
    const accepted: ExternalInvitation = { ...invitation, status: 'accepted', updatedAt: this.#tick() };
    this.#invitations.set(accepted.externalId, accepted);
    this.#emit({ type: 'invitation.accepted', data: accepted }, accepted.updatedAt);
    return this.#addMember(invitation.orgExternalId, subject, invitation.providerRole, {
      metadata: options.copyMetadata === false ? {} : { ...invitation.metadata },
      ...(options.includeInvitationId === false ? {} : { externalInvitationId: invitation.externalId }),
    });
  }

  /** Someone adds a member directly in the provider (its dashboard), without an invitation. */
  addMember(orgExternalId: string, subject: string, providerRole: string): ExternalMembership {
    this.#org(orgExternalId);
    this.#user(subject);
    return this.#addMember(orgExternalId, subject, providerRole, { metadata: {} });
  }

  // --- IdentityProvider --------------------------------------------------------------------------

  async verifyAccessToken(token: string, _ctx: VerifyTokenContext): Promise<VerifiedIdentity> {
    this.#maybeFail('verifyAccessToken');
    if (!token.startsWith('fake:')) throw new IdentityProviderError('unauthorized', 'fake: not a fake token');
    const [subject = '', ...parts] = token.slice('fake:'.length).split(';');
    let org: string | undefined;
    let pending = false;
    for (const part of parts) {
      if (part === 'pending') pending = true;
      else if (part.startsWith('org=') && part.length > 4) org = part.slice(4);
      else throw new IdentityProviderError('unauthorized', `fake: unknown token part "${part}"`);
    }
    if (!this.#users.has(subject)) throw new IdentityProviderError('unauthorized', 'fake: no such user');
    return {
      issuer: this.issuer,
      subject,
      sessionId: `sess_${subject}`,
      pending,
      ...(org === undefined ? {} : { activeOrgExternalId: org }),
    };
  }

  async getUser(subject: string): Promise<ExternalUser | null> {
    this.#maybeFail('getUser');
    return this.#users.get(subject) ?? null;
  }

  async listUserOrganizations(subject: string): Promise<UserOrganization[]> {
    this.#maybeFail('listUserOrganizations');
    const found: UserOrganization[] = [];
    for (const [orgId, members] of this.#members) {
      const membership = members.get(subject);
      if (membership) found.push({ org: this.#org(orgId), membership });
    }
    return found;
  }

  async createOrganization(input: CreateOrganizationInput): Promise<ExternalOrg> {
    this.#maybeFail('createOrganization');
    if (input.slug !== undefined && [...this.#orgs.values()].some((org) => org.slug === input.slug)) {
      throw new IdentityProviderError('conflict', `fake: slug ${input.slug} is taken`);
    }
    if (input.createdBySubject !== undefined) this.#user(input.createdBySubject);
    const org: ExternalOrg = {
      externalId: this.#id('org'),
      name: input.name,
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      metadata: { ...input.metadata },
      updatedAt: this.#tick(),
    };
    this.#orgs.set(org.externalId, org);
    this.#members.set(org.externalId, new Map());
    this.#emit({ type: 'org.upserted', data: org }, org.updatedAt);
    if (input.createdBySubject !== undefined) {
      this.#addMember(org.externalId, input.createdBySubject, FAKE_ROLES.toProvider('admin'), {
        metadata: {},
      });
    }
    return org;
  }

  async findOrganizationByMetadata(key: string, value: string): Promise<ExternalOrg | null> {
    this.#maybeFail('findOrganizationByMetadata');
    return [...this.#orgs.values()].find((org) => org.metadata[key] === value) ?? null;
  }

  async deleteOrganization(externalId: string): Promise<void> {
    this.#maybeFail('deleteOrganization');
    if (!this.#orgs.delete(externalId)) return;
    this.#members.delete(externalId);
    for (const [id, invitation] of this.#invitations)
      if (invitation.orgExternalId === externalId) this.#invitations.delete(id);
    this.#emit({ type: 'org.deleted', data: { externalId } }, this.#tick());
  }

  async *listOrganizationMembers(orgExternalId: string): AsyncIterable<ExternalMembership> {
    this.#maybeFail('listOrganizationMembers');
    this.#org(orgExternalId);
    yield* [...(this.#members.get(orgExternalId)?.values() ?? [])];
  }

  async updateMemberRole(
    orgExternalId: string,
    subject: string,
    role: MembershipRole,
  ): Promise<ExternalMembership> {
    this.#maybeFail('updateMemberRole');
    const membership = this.#members.get(orgExternalId)?.get(subject);
    if (!membership)
      throw new IdentityProviderError('not_found', `fake: ${subject} is not a member of ${orgExternalId}`);
    const providerRole = FAKE_ROLES.toProvider(role);
    if (membership.providerRole === providerRole) return membership;
    const updated: ExternalMembership = { ...membership, providerRole, updatedAt: this.#tick() };
    this.#members.get(orgExternalId)?.set(subject, updated);
    this.#emit({ type: 'membership.upserted', data: updated }, updated.updatedAt);
    return updated;
  }

  async removeMember(orgExternalId: string, subject: string): Promise<void> {
    this.#maybeFail('removeMember');
    if (this.#members.get(orgExternalId)?.has(subject)) this.#removeMember(orgExternalId, subject);
  }

  async createInvitation(input: CreateInvitationInput): Promise<ExternalInvitation> {
    this.#maybeFail('createInvitation');
    this.#org(input.orgExternalId);
    const email = input.email.toLowerCase();
    const invitations = [...this.#invitations.values()].filter(
      (i) => i.orgExternalId === input.orgExternalId,
    );
    if (invitations.some((i) => i.email === email && i.status === 'pending')) {
      throw new IdentityProviderError('conflict', `fake: ${email} already has a pending invitation`);
    }
    for (const subject of this.#members.get(input.orgExternalId)?.keys() ?? []) {
      if (this.#users.get(subject)?.primaryEmail === email)
        throw new IdentityProviderError('conflict', `fake: ${email} is a member`);
    }
    const now = this.#tick();
    const invitation: ExternalInvitation = {
      externalId: this.#id('orginv'),
      orgExternalId: input.orgExternalId,
      email,
      providerRole: FAKE_ROLES.toProvider(input.role),
      status: 'pending',
      metadata: { ...input.metadata },
      expiresAt: now + (input.expiresInDays ?? 30) * DAY_MS,
      updatedAt: now,
    };
    this.#invitations.set(invitation.externalId, invitation);
    return invitation;
  }

  async revokeInvitation(orgExternalId: string, invitationExternalId: string): Promise<ExternalInvitation> {
    this.#maybeFail('revokeInvitation');
    const invitation = this.#invitations.get(invitationExternalId);
    if (!invitation || invitation.orgExternalId !== orgExternalId) {
      throw new IdentityProviderError('not_found', `fake: no invitation ${invitationExternalId}`);
    }
    if (invitation.status === 'revoked') return invitation;
    if (invitation.status !== 'pending')
      throw new IdentityProviderError('conflict', `fake: invitation is ${invitation.status}`);
    const revoked: ExternalInvitation = { ...invitation, status: 'revoked', updatedAt: this.#tick() };
    this.#invitations.set(invitationExternalId, revoked);
    this.#emit({ type: 'invitation.revoked', data: revoked }, revoked.updatedAt);
    return revoked;
  }

  async listInvitations(
    orgExternalId: string,
    status?: ExternalInvitationStatus,
  ): Promise<ExternalInvitation[]> {
    this.#maybeFail('listInvitations');
    this.#org(orgExternalId);
    return [...this.#invitations.values()].filter(
      (i) => i.orgExternalId === orgExternalId && (status === undefined || i.status === status),
    );
  }

  async parseWebhook(request: WebhookRequest): Promise<NormalizedIdentityEvent | null> {
    this.#maybeFail('parseWebhook');
    const header = Object.entries(request.headers).find(
      ([name]) => name.toLowerCase() === FAKE_SIGNATURE_HEADER,
    )?.[1];
    const expected = Buffer.from(this.#sign(request.rawBody));
    const given = Buffer.from(header ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new IdentityProviderError('unauthorized', 'fake: bad webhook signature');
    }
    let body: unknown;
    try {
      body = JSON.parse(request.rawBody);
    } catch (error) {
      throw new IdentityProviderError('invalid', 'fake: webhook body is not JSON', { cause: error });
    }
    const type = (body as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null;
    const parsed = NormalizedIdentityEvent.safeParse(body);
    if (!parsed.success)
      throw new IdentityProviderError('invalid', `fake: bad ${type} event: ${parsed.error.message}`);
    return parsed.data;
  }

  // --- internals ---------------------------------------------------------------------------------

  #maybeFail(method: FakeMethod): void {
    const error = this.#failures.get(method)?.shift();
    if (error) throw error;
  }

  #tick(): number {
    this.#lastTime = Math.max(this.#clock().getTime(), this.#lastTime + 1);
    return this.#lastTime;
  }

  #id(prefix: string): string {
    return `${prefix}_${++this.#counter}`;
  }

  #emit(body: EventBody, at: number): void {
    this.#events.push({
      ...body,
      provider: this.kind,
      externalEventId: this.#id('evt'),
      occurredAt: at,
    } as NormalizedIdentityEvent);
  }

  #sign(rawBody: string): string {
    return `sha256=${createHmac('sha256', this.#secret).update(rawBody).digest('hex')}`;
  }

  #user(subject: string): ExternalUser {
    const user = this.#users.get(subject);
    if (!user) throw new IdentityProviderError('not_found', `fake: no user ${subject}`);
    return user;
  }

  #org(orgExternalId: string): ExternalOrg {
    const org = this.#orgs.get(orgExternalId);
    if (!org) throw new IdentityProviderError('not_found', `fake: no organization ${orgExternalId}`);
    return org;
  }

  #addMember(
    orgExternalId: string,
    subject: string,
    providerRole: string,
    extra: { metadata: ExternalMembership['metadata']; externalInvitationId?: string },
  ): ExternalMembership {
    const members = this.#members.get(orgExternalId);
    if (members?.has(subject)) throw new IdentityProviderError('conflict', 'fake: already a member');
    const membership: ExternalMembership = {
      orgExternalId,
      subject,
      externalMembershipId: this.#id('orgmem'),
      providerRole,
      ...extra,
      updatedAt: this.#tick(),
    };
    members?.set(subject, membership);
    this.#emit({ type: 'membership.upserted', data: membership }, membership.updatedAt);
    return membership;
  }

  #removeMember(orgExternalId: string, subject: string): void {
    const membership = this.#members.get(orgExternalId)?.get(subject);
    if (!membership) return;
    this.#members.get(orgExternalId)?.delete(subject);
    const data = { orgExternalId, subject, externalMembershipId: membership.externalMembershipId };
    this.#emit({ type: 'membership.deleted', data }, this.#tick());
  }
}
