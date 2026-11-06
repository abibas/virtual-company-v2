/**
 * The API keys tests' helpers: the keys path of a company, making a key through the API as a person (the test fails
 * on anything but a 201), and the raw rows a key leaves behind.
 */
import { apiKeys, auditLog, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq } from 'drizzle-orm';
import type { ApiKeyView, CreatedApiKeyView } from '../../src/modules/api-keys/schemas.ts';
import { as, type MembersCompany } from './members/members.ts';
import type { AuthWorld, Person } from './platform/auth.ts';

export type { ApiKeyView, CreatedApiKeyView };

export const keysPath = (company: Pick<MembersCompany, 'companyId'>, keyId?: string) =>
  `/api/companies/${company.companyId}/api-keys${keyId === undefined ? '' : `/${keyId}`}`;

/** Makes a personal key through the API, signed in as `person` with a session. */
export async function makeKey(
  w: AuthWorld,
  company: MembersCompany,
  person: Person,
  body: { name?: string; expiresInDays?: number } = {},
): Promise<CreatedApiKeyView> {
  const res = await as(w, person)('POST', keysPath(company), { name: 'laptop', ...body });
  if (res.status !== 201)
    throw new Error(`POST api-keys answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as CreatedApiKeyView;
}

export const keyRows = (db: DbHandle, companyId: string) =>
  rawDb(db).select().from(apiKeys).where(eq(apiKeys.companyId, companyId)).orderBy(asc(apiKeys.createdAt));

/** The audit rows of one key, oldest first, without their ids and times. */
export async function keyAudit(db: DbHandle, keyId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'api_key'), eq(auditLog.entityId, keyId)))
    .orderBy(asc(auditLog.id));
  return rows.map(({ id: _id, createdAt: _at, ...row }) => row);
}
