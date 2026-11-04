import {
  type ApiKey,
  type AuditEntry,
  apiKeys,
  auditChanges,
  isUuid,
  type Membership,
  memberships,
  type TenantDb,
  type TenantSet,
} from '@mwc/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';

/** One membership of this company by id; undefined for an unknown or malformed id, or another company's. */
async function getMembership(t: TenantDb, id: string): Promise<Membership | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(memberships, eq(memberships.id, id));
  return row;
}

/**
 * The members module's data access, through the company's tenant only: its memberships, the API keys of a person
 * leaving, the company row's lock that serializes every role change and removal, and the audit rows.
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

    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}

export type MembersRepo = ReturnType<typeof membersRepo>;
