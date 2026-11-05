import { asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../src/handle.ts';
import { rawDb } from '../src/handle.ts';
import { type Company, companies, invitations, memberships, principals } from '../src/schema/index.ts';
import {
  CompanyNotFoundError,
  isCompanyNotFound,
  isUuid,
  SlugTakenError,
  type TenantDb,
  tenant,
  tenantOf,
  withNewCompany,
} from '../src/tenant.ts';
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

  it("reads only the columns named, of this company's rows only", async () => {
    const theirs = await insertPrincipal(handle, globex.id, 'agent');
    const [ours] = await t.insert(principals, { kind: 'agent' }).returning();
    const fields = { id: principals.id, kind: principals.kind };
    const rows = await t.selectFields(principals, fields, eq(principals.kind, 'agent'));
    expect(rows).toContainEqual({ id: ours?.id, kind: 'agent' });
    expect(rows.every((row) => Object.keys(row).join() === 'id,kind')).toBe(true);
    expect(rows.map((row) => row.id)).not.toContain(theirs.id);
    expect(await t.selectFields(principals, fields).orderBy(asc(principals.id))).toHaveLength(
      (await t.select(principals)).length,
    );
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

  it('opens inside a raw transaction with tenantOf: its rows commit and roll back with that transaction', async () => {
    const email = `${unique('raw')}@x.test`;
    const failed = rawDb(handle).transaction(async (tx) => {
      const inside = await tenantOf(tx, acme.id);
      expect(inside.company).toEqual(t.company);
      await inside.insert(invitations, invitation(email));
      throw new Error('the outer work fails');
    });
    await expect(failed).rejects.toThrow('the outer work fails');
    expect(await t.select(invitations, eq(invitations.emailNormalized, email))).toEqual([]);
    await rawDb(handle).transaction(async (tx) => {
      await (await tenantOf(tx, acme.id)).insert(invitations, invitation(email));
    });
    expect(await t.select(invitations, eq(invitations.emailNormalized, email))).toHaveLength(1);
    await expect(tenantOf(rawDb(handle), 'not-an-id')).rejects.toBeInstanceOf(CompanyNotFoundError);
  });

  it('keeps the company it was opened with', async () => {
    await rawDb(handle).update(companies).set({ name: 'Renamed' }).where(eq(companies.id, acme.id));
    expect(t.company.name).toBe(acme.name);
    expect((await tenant(handle, acme.id)).company.name).toBe('Renamed');
  });
});

describe('TenantDb: the company row', () => {
  it('updates the company itself, never its id, and only when the extra condition holds', async () => {
    const company = await insertCompany(handle, { status: 'provisioning' });
    const own = await tenant(handle, company.id);
    const set = { name: 'Provisioned', status: 'active', id: globex.id } as {
      name: string;
      status: 'active';
    };
    const [updated] = await own.updateCompany(set).returning();
    expect(updated).toMatchObject({ id: company.id, name: 'Provisioned', status: 'active' });
    expect((await tenant(handle, globex.id)).company.name).toBe(globex.name);
    expect(
      await own.updateCompany({ name: 'Never' }, eq(companies.status, 'provisioning')).returning(),
    ).toEqual([]);
    expect(await own.updateCompany({ name: 'Again' }, isNull(companies.deletedAt)).returning()).toHaveLength(
      1,
    );
  });

  it('locks the current row in a transaction and refuses a company deleted since it was opened', async () => {
    const company = await insertCompany(handle);
    const own = await tenant(handle, company.id);
    await own.updateCompany({ name: 'Current' });
    const locked = await own.transaction((tx) => tx.lockCompany());
    expect(locked).toMatchObject({ id: company.id, name: 'Current' });
    await own.updateCompany({ status: 'deleted' });
    await expect(own.transaction((tx) => tx.lockCompany())).rejects.toBeInstanceOf(CompanyNotFoundError);
    const soft = await tenant(handle, (await insertCompany(handle)).id);
    await soft.updateCompany({ deletedAt: new Date() });
    await expect(soft.lockCompany()).rejects.toMatchObject({ code: 'not_found', companyId: soft.companyId });
  });
});

describe('withNewCompany', () => {
  it('creates a provisioning company and hands its tenant to work in the same transaction', async () => {
    const user = await insertUser(handle);
    const slug = unique('new');
    const result = await withNewCompany(
      handle,
      { name: 'New Co', slugs: [slug], createdByUserId: user.id, identityProvider: 'fake' },
      async (tx) => {
        const [principal] = await tx.insert(principals, { kind: 'person' }).returning();
        return { company: tx.company, principal };
      },
    );
    expect(result.company).toMatchObject({
      slug,
      name: 'New Co',
      status: 'provisioning',
      identityProvider: 'fake',
      createdByUserId: user.id,
      identityOrgId: null,
    });
    expect(result.principal?.companyId).toBe(result.company.id);
    expect((await tenant(handle, result.company.id)).company).toEqual(result.company);
    const plain = await withNewCompany(
      handle,
      { name: 'Plain', slugs: [unique('plain')] },
      async (tx) => tx.company,
    );
    expect(plain).toMatchObject({ identityProvider: 'clerk', createdByUserId: null });
  });

  it('takes the first free slug and refuses when none is free', async () => {
    const taken = await insertCompany(handle);
    const free = unique('free');
    const company = await withNewCompany(
      handle,
      { name: 'Next', slugs: [taken.slug, free] },
      async (tx) => tx.company,
    );
    expect(company.slug).toBe(free);
    const none = withNewCompany(handle, { name: 'None', slugs: [taken.slug, free] }, async () => 'never');
    await expect(none).rejects.toBeInstanceOf(SlugTakenError);
    await expect(none).rejects.toMatchObject({ code: 'slug_taken', slugs: [taken.slug, free] });
  });

  it('rolls the company back when work fails', async () => {
    const slug = unique('rolled');
    const failed = withNewCompany(handle, { name: 'Rolled', slugs: [slug] }, async (tx) => {
      await tx.insert(principals, { kind: 'person' });
      throw new Error('work fails');
    });
    await expect(failed).rejects.toThrow('work fails');
    expect(await rawDb(handle).select().from(companies).where(eq(companies.slug, slug))).toEqual([]);
  });
});
