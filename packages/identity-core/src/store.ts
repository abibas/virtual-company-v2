import type { CompanyStatus, UserStatus } from '@mwc/shared/enums';
import type {
  InvitationStatus,
  MembershipRole,
  MembershipStatus,
  NormalizedIdentityEvent,
} from '@mwc/shared/identity';

/**
 * The storage port the projector writes through. `InMemoryIdentityStore` implements it for tests; S1.3's
 * database adapter implements it on the identity tables, one transaction per projected event. Absent
 * values are null, as in the database.
 */

export interface StoredUser {
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  /** Lower-cased. */
  readonly primaryEmail: string;
  /** The person's own name; null until they give one. */
  readonly displayName: string | null;
  /** The photo they chose; null for none. */
  readonly imageUrl: string | null;
  readonly status: UserStatus;
}

export interface StoredCompany {
  readonly id: string;
  /** The provider organization (`companies.identity_org_id`); null until the outbox created it. */
  readonly identityOrgExternalId: string | null;
  readonly status: CompanyStatus;
}

export interface StoredMembership {
  readonly id: string;
  readonly companyId: string;
  readonly userId: string;
  /** What applies (authorization reads it): `grantedRole`, raised to admin while the provider says admin. */
  readonly role: MembershipRole;
  /** What this product granted: the invitation's role, or a local role change. Never set from the provider. */
  readonly grantedRole: MembershipRole;
  readonly status: MembershipStatus;
  readonly externalMembershipId: string | null;
  /** The provider role of the newest provider state applied. */
  readonly providerRole: string | null;
  /** The local invitation this membership came from. */
  readonly invitationId: string | null;
}

export interface StoredInvitation {
  readonly id: string;
  readonly companyId: string;
  /** Lower-cased. Never used to link a membership. */
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: InvitationStatus;
  readonly externalInvitationId: string | null;
  readonly acceptedByUserId: string | null;
}

export type NewStoredUser = Omit<StoredUser, 'id'>;
export type NewStoredMembership = Omit<StoredMembership, 'id'>;
export type InvitationPatch = Partial<
  Pick<StoredInvitation, 'status' | 'acceptedByUserId' | 'externalInvitationId'>
>;

/**
 * Ordering bookkeeping per entity: `at` is the `updatedAt` of the newest provider state applied (null
 * when none was), `deleted` that the provider deleted it. Deletion never moves `at`, so fields keep
 * following the newest upsert while the deletion stays in force.
 */
export interface IdentityMark {
  readonly at: number | null;
  readonly deleted: boolean;
}

/** The keys of marks and of parked events. */
export const identityKeys = {
  user: (issuer: string, subject: string) => `user:${issuer}|${subject}`,
  membership: (companyId: string, userId: string) => `membership:${companyId}|${userId}`,
  externalMembership: (externalMembershipId: string) => `membership-ext:${externalMembershipId}`,
  org: (orgExternalId: string) => `org:${orgExternalId}`,
} as const;

export interface IdentityStore {
  getUser(issuer: string, subject: string): Promise<StoredUser | undefined>;
  getUserById(id: string): Promise<StoredUser | undefined>;
  /** Inserts or updates the user with this `(issuer, subject)`. */
  upsertUser(user: NewStoredUser): Promise<StoredUser>;

  getCompany(id: string): Promise<StoredCompany | undefined>;
  getCompanyByOrgExternalId(orgExternalId: string): Promise<StoredCompany | undefined>;

  getMembership(companyId: string, userId: string): Promise<StoredMembership | undefined>;
  listMemberships(
    filter: { readonly companyId: string } | { readonly userId: string },
  ): Promise<StoredMembership[]>;
  /** Inserts or updates the membership with this `(companyId, userId)`. */
  upsertMembership(membership: NewStoredMembership): Promise<StoredMembership>;

  getInvitation(id: string): Promise<StoredInvitation | undefined>;
  getInvitationByExternalId(externalInvitationId: string): Promise<StoredInvitation | undefined>;
  /** Marks an invitation (status, who accepted it, its provider id). */
  updateInvitation(id: string, patch: InvitationPatch): Promise<StoredInvitation>;

  getMark(key: string): Promise<IdentityMark | undefined>;
  setMark(key: string, mark: IdentityMark): Promise<void>;

  /**
   * Parks an event until what it needs exists (its user, or the company linked to its organization).
   * Parking the same event (by `externalEventId`) twice under one key keeps one.
   */
  defer(key: string, event: NormalizedIdentityEvent): Promise<void>;
  /** Removes and returns the events parked under a key, oldest first. */
  takeDeferred(key: string): Promise<NormalizedIdentityEvent[]>;
}
