import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../src/handle.ts';
import { rawDb } from '../src/handle.ts';
import { type Company, companies, invitations, memberships, principals } from '../src/schema/index.ts';
import { CompanyNotFoundError, isCompanyNotFound, isUuid, type TenantDb, tenant } from '../src/tenant.ts';
import { pgError, type TestDb } from '../src/testing.ts';
import {
  insertCompany,
  insertPrincipal,
  insertUser,
  inTwoWeeks,
  MISSING_ID,
  migratedTestDb,
  unique,
} from './fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let t: TenantDb;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  t = await tenant(handle, acme.id);
});
afterAll(() => testDb.close());

const invitation = (email = `${unique('t')}@x.test`) => ({
  emailNormalized: email,
  role: 'member' as const,
  expiresAt: inTwoWeeks(),
});

async function notFound(companyId: string): Promise<CompanyNotFoundError> {
  const error = await tenant(handle, companyId).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!isCompanyNotFound(error)) throw new Error(`expected CompanyNotFoundError, got ${String(error)}`);
  return error;
}

describe('tenant()', () => {
  it('opens an active, provisioning or suspended company, with its row', async () => {
    expect(t.companyId).toBe(acme.id);
    expect(t.company).toEqual(acme);
    for (const status of ['provisioning', 'suspended'] as const) {
      const company = await insertCompany(handle, { status });
      expect((await tenant(handle, company.id)).company.status).toBe(status);
    }
  });

  it('refuses a missing company, a deleted one and a malformed id with a typed not-found error', async () => {
    const deleted = await insertCompany(handle, { status: 'deleted' });
    const softDeleted = await insertCompany(handle, { deletedAt: new Date() });
    for (const id of [MISSING_ID, deleted.id, softDeleted.id, 'acme', '']) {
      const error = await notFound(id);
      expect(error).toBeInstanceOf(CompanyNotFoundError);
      expect(error).toMatchObject({ code: 'not_found', companyId: id, name: 'CompanyNotFoundError' });
      expect(error.message).toBe(`company ${id} not found`);
    }
    expect(isCompanyNotFound(new Error('company x not found'))).toBe(false);
  });

  it('tells UUIDs of any version from anything else', () => {
    expect(isUuid(acme.id)).toBe(true);
    expect(isUuid('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11')).toBe(true);
    expect(isUuid('c-acme')).toBe(false);
    expect(isUuid(`${acme.id}x`)).toBe(false);
  });
});

describe('TenantDb', () => {
  it("stamps this company's id on inserts, whatever the caller passed", async () => {
    const [one] = await t.insert(invitations, invitation()).returning();
    expect(one?.companyId).toBe(acme.id);
    const smuggled = { ...invitation(), companyId: globex.id } as ReturnType<typeof invitation>;
    const rows = await t.insert(invitations, [smuggled, invitation()]).returning();
    expect(rows.map((row) => row.companyId)).toEqual([acme.id, acme.id]);
  });

  it("reads only this company's rows, with a where and the usual chaining", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    const agents = await t.insert(principals, [{ kind: 'agent' }, { kind: 'agent' }]).returning();
    const all = await t.select(principals);
    expect(all.every((p) => p.companyId === acme.id)).toBe(true);
    expect(all.map((p) => p.id)).not.toContain(theirs.id);
    const chained = await t
      .select(principals, eq(principals.kind, 'agent'))
      .orderBy(asc(principals.id))
      .limit(1);
    expect(chained.map((p) => p.id)).toEqual([agents[0]?.id]);
    expect(await t.select(principals, eq(principals.id, theirs.id))).toEqual([]);
  });

  it("updates and deletes only this company's rows, and never moves a row to another company", async () => {
    const theirs = await (await tenant(handle, globex.id)).insert(invitations, invitation()).returning();
    const [ours] = await t.insert(invitations, invitation()).returning();
    const set = { status: 'revoked', companyId: globex.id } as { status: 'revoked' };
    const updated = await t.update(invitations, set, eq(invitations.status, 'pending')).returning();
    expect(updated.map((row) => row.id)).toContain(ours?.id);
    expect(updated.every((row) => row.companyId === acme.id)).toBe(true);
    const [untouched] = await rawDb(handle)
      .select()
      .from(invitations)
      .where(eq(invitations.id, theirs[0]?.id ?? ''));
    expect(untouched?.status).toBe('pending');

    const removed = await t.delete(invitations, eq(invitations.id, theirs[0]?.id ?? '')).returning();
    expect(removed).toEqual([]);
    expect(await t.delete(invitations, eq(invitations.id, ours?.id ?? '')).returning()).toHaveLength(1);
  });

  it('gives the scope as SQL for hand-built queries', async () => {
    await insertPrincipal(handle, globex.id);
    const rows = await rawDb(handle).select().from(principals).where(t.scoped(principals));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.companyId === acme.id)).toBe(true);
  });

  it("refuses another company's principal through the composite key, even via the tenant layer", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    const query = t.insert(memberships, {
      principalId: theirs.id,
      userId: (await insertUser(handle)).id,
      role: 'member',
      grantedRole: 'member',
    });
    expect(await pgError(query)).toMatchObject({ code: '23503', constraint: 'memberships_principal_fk' });
  });

  it('commits a transaction, rolls it back on an error, and nests', async () => {
    const email = `${unique('tx')}@x.test`;
    await t.transaction(async (tx) => {
      expect(tx.companyId).toBe(acme.id);
      await tx.insert(invitations, invitation(email));
      await tx
        .transaction(async (inner) => {
          await inner.insert(invitations, invitation(`${email}.inner`));
          throw new Error('inner fails');
        })
        .catch(() => undefined);
    });
    const kept = await t.select(invitations, eq(invitations.emailNormalized, email));
    expect(kept).toHaveLength(1);
    expect(await t.select(invitations, eq(invitations.emailNormalized, `${email}.inner`))).toEqual([]);

    const failed = t.transaction(async (tx) => {
      await tx.insert(invitations, invitation(`${email}.rolled`));
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    expect(await t.select(invitations, eq(invitations.emailNormalized, `${email}.rolled`))).toEqual([]);
  });

  it('keeps the company it was opened with', async () => {
    await rawDb(handle).update(companies).set({ name: 'Renamed' }).where(eq(companies.id, acme.id));
    expect(t.company.name).toBe(acme.name);
    expect((await tenant(handle, acme.id)).company.name).toBe('Renamed');
  });
});
