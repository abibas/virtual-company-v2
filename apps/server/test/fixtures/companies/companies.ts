/**
 * The companies tests' helpers: a person linked here in no company yet, calls to the companies API as someone,
 * and raw reads of the rows a company's changes leave behind (the company, its outbox calls, its audit rows).
 */
import {
  auditLog,
  companies as companyTable,
  type DbHandle,
  identityOutbox,
  memberships,
  principals,
  tenant,
  userIdentities,
  users,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { FAKE_ISSUER, type FakeIdentityProvider, type FakeMethod, requestJson } from '@mwc/testkit';
import { asc, eq } from 'drizzle-orm';
import type { CompanyView } from '../../../src/modules/companies/schemas.ts';
import { type AuthWorld, bearer, newSubject } from '../platform/auth.ts';

export interface LinkedUser {
  readonly subject: string;
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

/** A person the fake knows and this server has linked (user and identity), with no membership anywhere. */
export async function addUser(db: DbHandle, fake: FakeIdentityProvider, email?: string): Promise<LinkedUser> {
  const subject = newSubject('creator');
  const address = email ?? `${subject}@creators.test`;
  fake.createUser({ subject, email: address });
  const [user] = await rawDb(db)
    .insert(users)
    .values({ primaryEmail: address, displayName: subject })
    .returning();
  const userId = (user as { id: string }).id;
  await rawDb(db).insert(userIdentities).values({ userId, provider: 'fake', issuer: FAKE_ISSUER, subject });
  return { subject, userId, email: address, token: `fake:${subject}` };
}

/** A membership of a linked user in a company (with its person principal), through the tenant layer. */
export async function joinCompany(
  db: DbHandle,
  companyId: string,
  userId: string,
  role: MembershipRole,
  status: MembershipStatus = 'active',
): Promise<{ principalId: string }> {
  const t = await tenant(db, companyId);
  const [principal] = await t.insert(principals, { kind: 'person' }).returning();
  const principalId = (principal as { id: string }).id;
  await t.insert(memberships, { principalId, userId, role, grantedRole: role, status });
  return { principalId };
}

/** One request to the API as the holder of `token` (with `x-request-id` when given). */
export function call(w: AuthWorld, token: string | undefined, requestId?: string) {
  const headers = {
    ...(token === undefined ? {} : bearer(token)),
    ...(requestId === undefined ? {} : { 'x-request-id': requestId }),
  };
  return (method: string, path: string, body?: unknown) =>
    requestJson(w.t.app, method, path, { body, headers });
}

/** Creates a company through the API and returns it (the test fails on anything but a 201). */
export async function createCompany(w: AuthWorld, token: string, body: { name: string; slug?: string }) {
  const res = await call(w, token)('POST', '/api/companies', body);
  if (res.status !== 201)
    throw new Error(`POST /api/companies answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as CompanyView;
}

export const companyRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(companyTable).where(eq(companyTable.id, id)))[0];

export const outboxOf = (db: DbHandle, companyId: string) =>
  rawDb(db)
    .select()
    .from(identityOutbox)
    .where(eq(identityOutbox.companyId, companyId))
    .orderBy(asc(identityOutbox.createdAt), asc(identityOutbox.op));

export const auditOf = (db: DbHandle, companyId: string) =>
  rawDb(db).select().from(auditLog).where(eq(auditLog.companyId, companyId)).orderBy(asc(auditLog.id));

/** An audit row as the assertions compare it: without its id and time. */
export const auditFields = (rows: Awaited<ReturnType<typeof auditOf>>) =>
  rows.map(({ id: _id, createdAt: _at, ...row }) => row);

/**
 * Lets the next call of `method` take effect at the fake and then reject as `unavailable`, as if the provider's
 * answer were lost on the way back; the call after it answers normally again.
 */
export function loseNextAnswer(fake: FakeIdentityProvider, method: FakeMethod): void {
  const original = fake[method] as (...args: unknown[]) => Promise<unknown>;
  Object.defineProperty(fake, method, {
    configurable: true,
    value: async (...args: unknown[]) => {
      Reflect.deleteProperty(fake, method);
      await original.apply(fake, args);
      throw new IdentityProviderError('unavailable', `fake: the answer of ${method} was lost`);
    },
  });
}
