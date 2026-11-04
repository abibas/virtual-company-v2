import {
  type ApiKey,
  type AuditEntry,
  apiKeys,
  auditChanges,
  type Invitation,
  invitations,
  isUuid,
  type Membership,
  memberships,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import type { InvitationStatus } from '@mwc/shared/enums';
import { and, asc, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';

/** One membership of this company by id; undefined for an unknown or malformed id, or another company's. */
async function getMembership(t: TenantDb, id: string): Promise<Membership | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(memberships, eq(memberships.id, id));
  return row;
}

/** One invitation of this company by id; undefined for an unknown or malformed id, or another company's. */
async function getInvitation(t: TenantDb, id: string): Promise<Invitation | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(invitations, eq(invitations.id, id));
  return row;
}

/**
 * The rows S1.7 added: a person's membership by user, the acting member under the company's lock (as `lockedPair`),
 * and the company's invitations, through its tenant only. `membersRepo` spreads them in.
 */
const invitationRows = {
  /** The person's membership in this company, whatever its status. */
  async getByUser(t: TenantDb, userId: string): Promise<Membership | undefined> {
    const [row] = await t.select(memberships, eq(memberships.userId, userId));
    return row;
  },

  /** Locks the company row until the transaction ends (as `lockedPair`) and reads the acting member's membership. */
  async lockedActor(t: TenantDb, actorId: string): Promise<Membership | undefined> {
    await t.lockCompany();
    return getMembership(t, actorId);
  },

  getInvitation,

  /** The company's invitations whose stored status is one of `statuses` (all when undefined), newest first. */
  listInvitations: (t: TenantDb, statuses?: readonly InvitationStatus[]): Promise<Invitation[]> =>
    t
      .select(invitations, statuses === undefined ? undefined : inArray(invitations.status, [...statuses]))
      .orderBy(desc(invitations.createdAt), desc(invitations.id)),

  /** The company's pending invitation for this (normalized) email, if any: there is at most one. */
  async pendingFor(t: TenantDb, email: string): Promise<Invitation | undefined> {
    const pending = and(eq(invitations.emailNormalized, email), eq(invitations.status, 'pending'));
    const [row] = await t.select(invitations, pending);
    return row;
  },

  async insertInvitation(t: TenantDb, values: TenantValues<typeof invitations>): Promise<Invitation> {
    const [row] = (await t.insert(invitations, values).returning()) as [Invitation];
    return row;
  },

  async updateInvitation(t: TenantDb, id: string, set: TenantSet<typeof invitations>): Promise<Invitation> {
    const [row] = (await t.update(invitations, set, eq(invitations.id, id)).returning()) as [Invitation];
    return row;
  },

  /** Stores `expired` on the company's pending invitations whose expiry has passed; returns them, expired. */
  expireOverdue: (t: TenantDb, now: Date): Promise<Invitation[]> =>
    t
      .update(
        invitations,
        { status: 'expired' },
        and(eq(invitations.status, 'pending'), lte(invitations.expiresAt, now)),
      )
      .returning(),
};

/**
 * The members module's data access, through the company's tenant only: its memberships and invitations, the API
 * keys of a person leaving, the company row's lock that serializes every role change, removal and invitation
 * change, and the audit rows.
 */
export function membersRepo() {
  return {
    /** The memberships that are not removed, in the order people joined. */
    list: (t: TenantDb): Promise<Membership[]> =>
      t
        .select(memberships, ne(memberships.status, 'removed'))
        .orderBy(asc(memberships.createdAt), asc(memberships.id)),

    get: getMembership,

    /**
     * Locks the company row until the transaction ends, so role changes and removals in one company run one after
     * the other (a deleted company is refused, 404), then reads the acting member's and the target's memberships as
     * they are now (`[actor, target]`): the decision and the last-owner guard see what the change before this one
     * left.
     */
    async lockedPair(t: TenantDb, actorId: string, targetId: string) {
      await t.lockCompany();
      return [await getMembership(t, actorId), await getMembership(t, targetId)] as const;
    },

    /** How many active owners the company has (a handful at most, so the rows are counted here). */
    async activeOwners(t: TenantDb): Promise<number> {
      const owner = and(eq(memberships.role, 'owner'), eq(memberships.status, 'active'));
      return (await t.select(memberships, owner)).length;
    },

    async update(t: TenantDb, id: string, set: TenantSet<typeof memberships>): Promise<Membership> {
      const [row] = (await t.update(memberships, set, eq(memberships.id, id)).returning()) as [Membership];
      return row;
    },

    /** Revokes the principal's API keys in this company that are not revoked yet; returns them as revoked. */
    revokeKeys: (t: TenantDb, principalId: string, at: Date): Promise<ApiKey[]> =>
      t
        .update(
          apiKeys,
          { revokedAt: at },
          and(eq(apiKeys.principalId, principalId), isNull(apiKeys.revokedAt)),
        )
        .returning(),

    ...invitationRows,

    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}

export type MembersRepo = ReturnType<typeof membersRepo>;
