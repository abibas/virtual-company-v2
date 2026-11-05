import { companies, isUuid, type Membership, memberships, principals } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { NewStoredMembership, StoredCompany, StoredMembership } from '@mwc/identity-core';
import { and, asc, eq } from 'drizzle-orm';
import { type ChartActor, chartStep, lockedTenant, type MemberChart, moveOnChart } from './chart.ts';

/**
 * Companies as the projector sees them (id, organization link, status) and memberships across companies.
 * A new membership gets its person principal in the same transaction: a principal is a person in one company. A
 * membership that turns active or stops being active moves its person on the org chart in that transaction too.
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

/** Writes the membership of `(companyId, userId)` over `before`, or makes it with a new person principal. */
async function writeMembership(
  db: RawDb,
  membership: NewStoredMembership,
  before: Membership | undefined,
): Promise<Membership> {
  const { companyId, userId, ...fields } = membership;
  if (before) {
    const where = and(eq(memberships.companyId, companyId), eq(memberships.userId, userId));
    const [updated] = (await db.update(memberships).set(fields).where(where).returning()) as [Membership];
    return updated;
  }
  const [principal] = (await db
    .insert(principals)
    .values({ companyId, kind: 'person' })
    .returning({ id: principals.id })) as [{ id: string }];
  const [created] = (await db
    .insert(memberships)
    .values({ ...fields, companyId, userId, principalId: principal.id })
    .returning()) as [Membership];
  return created;
}

/**
 * Updates the membership of `(companyId, userId)`, or makes it with a new person principal, in one transaction. When
 * it turns active, or stops being active, the company row is locked first and the person is placed on the org chart
 * or taken off it, their reports moved up (`chart`, by `by`), in the same transaction; a deleted company's chart is
 * left as it is.
 */
export async function upsertMembership(
  db: RawDb,
  membership: NewStoredMembership,
  hook: { readonly chart: MemberChart; readonly by: ChartActor },
): Promise<StoredMembership> {
  const { companyId, userId } = membership;
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
    const step = chartStep(before?.status, membership.status);
    const t = step && (await lockedTenant(tx, companyId));
    const saved = await writeMembership(tx, membership, before);
    if (step && t) await moveOnChart(t, step, saved, hook);
    return stored(saved);
  });
}
