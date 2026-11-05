import type {
  ExternalInvitation,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';

export interface FakeUserInput {
  readonly subject?: string;
  readonly email: string;
  /** The person's name; the email's part before the @ when left out, none (as a real sign-up without one) for null. */
  readonly displayName?: string | null;
  readonly imageUrl?: string;
}

/** A profile change: undefined keeps a field; a null name or image removes it (the photo taken away). */
export interface FakeUserPatch {
  readonly email?: string;
  readonly displayName?: string | null;
  readonly imageUrl?: string | null;
}

export interface AcceptOptions {
  /** Copy the invitation's private metadata onto the membership, as Clerk does; default true. */
  readonly copyMetadata?: boolean;
  /** Put the invitation's id on the membership (`externalInvitationId`); default true. */
  readonly includeInvitationId?: boolean;
}

export type EventBody = NormalizedIdentityEvent extends infer E
  ? E extends NormalizedIdentityEvent
    ? Pick<E, 'type' | 'data'>
    : never
  : never;

/**
 * What the fake provider holds: users, organizations, memberships and invitations, the event queue, a
 * clock that only moves forward, and ids. The dashboard actions (a person signs up, accepts an
 * invitation, an admin adds a member) live here too; `FakeIdentityProvider` is the provider on top.
 */
export class FakeWorld {
  readonly users = new Map<string, ExternalUser>();
  readonly deletedUsers = new Set<string>();
  readonly orgs = new Map<string, ExternalOrg>();
  /** Organization → subject → membership. */
  readonly members = new Map<string, Map<string, ExternalMembership>>();
  readonly invitations = new Map<string, ExternalInvitation>();
  readonly provider: string;
  readonly #clock: () => Date;
  #lastTime = 0;
  #counter = 0;
  #events: NormalizedIdentityEvent[] = [];

  constructor(provider: string, clock: () => Date) {
    this.provider = provider;
    this.#clock = clock;
  }

  /** The events emitted since the last drain, oldest first, with strictly increasing `occurredAt`. */
  drainEvents(): NormalizedIdentityEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  /** A person signs up. */
  createUser(input: FakeUserInput): ExternalUser {
    const subject = input.subject ?? this.id('user');
    if (this.users.has(subject) || this.deletedUsers.has(subject))
      throw new IdentityProviderError('conflict', `fake: user ${subject} exists`);
    const email = input.email.toLowerCase();
    const user: ExternalUser = {
      subject,
      primaryEmail: email,
      displayName: input.displayName === undefined ? (email.split('@')[0] ?? email) : input.displayName,
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
      updatedAt: this.tick(),
    };
    this.users.set(subject, user);
    this.emit({ type: 'user.upserted', data: user }, user.updatedAt);
    return user;
  }

  /** A person changes their profile. */
  updateUser(subject: string, patch: FakeUserPatch): ExternalUser {
    const { imageUrl: image, ...user } = this.user(subject);
    const imageUrl = patch.imageUrl === undefined ? image : (patch.imageUrl ?? undefined);
    const updated: ExternalUser = {
      ...user,
      ...(patch.email === undefined ? {} : { primaryEmail: patch.email.toLowerCase() }),
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
      updatedAt: this.tick(),
    };
    this.users.set(subject, updated);
    this.emit({ type: 'user.upserted', data: updated }, updated.updatedAt);
    return updated;
  }

  /** The account is deleted: its memberships go first (each emitted), then the user. */
  deleteUser(subject: string): void {
    this.user(subject);
    for (const [orgId, members] of this.members)
      if (members.has(subject)) this.removeMembership(orgId, subject);
    this.users.delete(subject);
    this.deletedUsers.add(subject);
    this.emit({ type: 'user.deleted', data: { subject } }, this.tick());
  }

  /**
   * The invitee accepts: the invitation turns accepted and a membership with the invitation's role
   * appears, carrying its metadata (and its id) unless told otherwise.
   */
  accept(invitationExternalId: string, subject: string, options: AcceptOptions = {}): ExternalMembership {
    const invitation = this.invitations.get(invitationExternalId);
    if (!invitation)
      throw new IdentityProviderError('not_found', `fake: no invitation ${invitationExternalId}`);
    if (invitation.status !== 'pending')
      throw new IdentityProviderError('conflict', `fake: invitation is ${invitation.status}`);
    this.user(subject);
    if (this.members.get(invitation.orgExternalId)?.has(subject))
      throw new IdentityProviderError('conflict', 'fake: already a member');
    const accepted: ExternalInvitation = { ...invitation, status: 'accepted', updatedAt: this.tick() };
    this.invitations.set(accepted.externalId, accepted);
    this.emit({ type: 'invitation.accepted', data: accepted }, accepted.updatedAt);
    return this.addMembership(invitation.orgExternalId, subject, invitation.providerRole, {
      metadata: options.copyMetadata === false ? {} : { ...invitation.metadata },
      ...(options.includeInvitationId === false ? {} : { externalInvitationId: invitation.externalId }),
    });
  }

  /** Someone adds a member directly in the provider (its dashboard), without an invitation. */
  addMember(orgExternalId: string, subject: string, providerRole: string): ExternalMembership {
    this.org(orgExternalId);
    this.user(subject);
    return this.addMembership(orgExternalId, subject, providerRole, { metadata: {} });
  }

  // --- what the provider uses ------------------------------------------------------------------

  /** The clock's time in epoch milliseconds, without moving the event times (`tick`). */
  now(): number {
    return this.#clock().getTime();
  }

  tick(): number {
    this.#lastTime = Math.max(this.#clock().getTime(), this.#lastTime + 1);
    return this.#lastTime;
  }

  id(prefix: string): string {
    return `${prefix}_${++this.#counter}`;
  }

  emit(body: EventBody, at: number): void {
    this.#events.push({
      ...body,
      provider: this.provider,
      externalEventId: this.id('evt'),
      occurredAt: at,
    } as NormalizedIdentityEvent);
  }

  user(subject: string): ExternalUser {
    const user = this.users.get(subject);
    if (!user) throw new IdentityProviderError('not_found', `fake: no user ${subject}`);
    return user;
  }

  org(orgExternalId: string): ExternalOrg {
    const org = this.orgs.get(orgExternalId);
    if (!org) throw new IdentityProviderError('not_found', `fake: no organization ${orgExternalId}`);
    return org;
  }

  addMembership(
    orgExternalId: string,
    subject: string,
    providerRole: string,
    extra: { metadata: ExternalMembership['metadata']; externalInvitationId?: string },
  ): ExternalMembership {
    const members = this.members.get(orgExternalId);
    if (members?.has(subject)) throw new IdentityProviderError('conflict', 'fake: already a member');
    const membership: ExternalMembership = {
      orgExternalId,
      subject,
      externalMembershipId: this.id('orgmem'),
      providerRole,
      ...extra,
      updatedAt: this.tick(),
    };
    members?.set(subject, membership);
    this.emit({ type: 'membership.upserted', data: membership }, membership.updatedAt);
    return membership;
  }

  removeMembership(orgExternalId: string, subject: string): void {
    const membership = this.members.get(orgExternalId)?.get(subject);
    if (!membership) return;
    this.members.get(orgExternalId)?.delete(subject);
    const data = { orgExternalId, subject, externalMembershipId: membership.externalMembershipId };
    this.emit({ type: 'membership.deleted', data }, this.tick());
  }
}
