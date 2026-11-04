import { companies, isUuid, memberships, users } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import { and, asc, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';

/**
 * What `GET /api/me` reads, the user and their memberships across companies, and the profiles a company's member
 * list shows (raw, as the identity repo is: users are global rows).
 */

export interface UserProfile {
  readonly id: string;
  readonly primaryEmail: string;
  readonly displayName: string;
  readonly imageUrl: string | null;
  readonly status: 'active' | 'deactivated';
}

const profileColumns = {
  id: users.id,
  primaryEmail: users.primaryEmail,
  displayName: users.displayName,
  imageUrl: users.imageUrl,
  status: users.status,
};

export async function getUserProfile(db: RawDb, id: string): Promise<UserProfile | undefined> {
  const [row] = await db.select(profileColumns).from(users).where(eq(users.id, id));
  return row;
}

/** The profiles of these users; unknown and malformed ids are left out. */
export async function getUserProfiles(db: RawDb, ids: readonly string[]): Promise<UserProfile[]> {
  const valid = [...new Set(ids)].filter(isUuid);
  if (valid.length === 0) return [];
  return db.select(profileColumns).from(users).where(inArray(users.id, valid));
}

export interface UserCompany {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
  readonly companyStatus: typeof companies.$inferSelect.status;
  /** The identity provider's organization of the company; null while it is provisioning. */
  readonly identityOrgId: string | null;
  readonly role: typeof memberships.$inferSelect.role;
  readonly status: typeof memberships.$inferSelect.status;
}

/**
 * The user's memberships that are not removed, in companies that are not deleted, by company name; only in
 * `onlyCompanyId` when it is given (an API key bound to one company).
 */
export async function listUserCompanies(
  db: RawDb,
  userId: string,
  onlyCompanyId?: string,
): Promise<UserCompany[]> {
  const where: SQL[] = [
    eq(memberships.userId, userId),
    ne(memberships.status, 'removed'),
    ne(companies.status, 'deleted'),
    isNull(companies.deletedAt),
  ];
  if (onlyCompanyId !== undefined) where.push(eq(memberships.companyId, onlyCompanyId));
  return db
    .select({
      companyId: companies.id,
      slug: companies.slug,
      name: companies.name,
      companyStatus: companies.status,
      identityOrgId: companies.identityOrgId,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(...where))
    .orderBy(asc(companies.name), asc(companies.id));
}
