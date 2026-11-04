import { companies, isUuid, type Membership, memberships, principals } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { NewStoredMembership, StoredCompany, StoredMembership } from '@mwc/identity-core';
import { and, asc, eq } from 'drizzle-orm';

/**
 * Companies as the projector sees them (id, organization link, status) and memberships across companies.
 * A new membership gets its person principal in the same transaction: a principal is a person in one company.
 */

const companyColumns = {
  id: companies.id,
  identityOrgExternalId: companies.identityOrgId,
  status: companies.status,
};

export async function getCompany(db: RawDb, id: string): Promise<StoredCompany | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select(companyColumns).from(companies).where(eq(companies.id, id));
  return row;
}

export async function getCompanyByOrgExternalId(
  db: RawDb,
  orgExternalId: string,
): Promise<StoredCompany | undefined> {
  const [row] = await db
    .select(companyColumns)
    .from(companies)
    .where(eq(companies.identityOrgId, orgExternalId));
  return row;
}

function stored(row: Membership): StoredMembership {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    role: row.role,
    grantedRole: row.grantedRole,
    status: row.status,
    externalMembershipId: row.externalMembershipId,
    providerRole: row.providerRole,
    invitationId: row.invitationId,
  };
}

export async function getMembership(
  db: RawDb,
  companyId: string,
  userId: string,
): Promise<StoredMembership | undefined> {
  if (!isUuid(companyId) || !isUuid(userId)) return undefined;
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
  return row && stored(row);
}

export async function listMemberships(
  db: RawDb,
  filter: { readonly companyId: string } | { readonly userId: string },
): Promise<StoredMembership[]> {
  const [column, value] =
    'companyId' in filter ? [memberships.companyId, filter.companyId] : [memberships.userId, filter.userId];
  if (!isUuid(value)) return [];
  const rows = await db.select().from(memberships).where(eq(column, value)).orderBy(asc(memberships.id));
  return rows.map(stored);
}

/** Updates the membership of `(companyId, userId)`, or makes it with a new person principal. */
export async function upsertMembership(
  db: RawDb,
  membership: NewStoredMembership,
): Promise<StoredMembership> {
  const { companyId, userId, ...fields } = membership;
  const [updated] = await db
    .update(memberships)
    .set(fields)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)))
    .returning();
  if (updated) return stored(updated);
  return db.transaction(async (tx) => {
    const [principal] = (await tx
      .insert(principals)
      .values({ companyId, kind: 'person' })
      .returning({ id: principals.id })) as [{ id: string }];
    const [created] = (await tx
      .insert(memberships)
      .values({ ...fields, companyId, userId, principalId: principal.id })
      .returning()) as [Membership];
    return stored(created);
  });
}
