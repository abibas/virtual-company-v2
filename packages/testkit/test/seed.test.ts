import { CompanyNotFoundError, memberships, principals, tenant, userIdentities } from '@mwc/db';
import { migrateToLatest, rawDb } from '@mwc/db/system';
import { FAKE_ISSUER } from '@mwc/identity-core/fake';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/db.ts';
import { seedCompany } from '../src/seed.ts';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
});
afterAll(() => testDb.close());

describe('seedCompany', () => {
  it('makes an active company with its owner: user, identity, person principal, owner membership', async () => {
    const { company, owner, tenant: t } = await seedCompany(testDb.handle);
    expect(company).toMatchObject({ status: 'active', createdByUserId: owner.user.id, identityOrgId: null });
    expect(company.slug).toMatch(/^seed-[0-9a-f]{8}$/);
    expect(owner.principal).toMatchObject({ companyId: company.id, kind: 'person' });
    expect(owner.membership).toMatchObject({
      companyId: company.id,
      principalId: owner.principal.id,
      userId: owner.user.id,
      role: 'owner',
      grantedRole: 'owner',
      status: 'active',
    });
    expect(t.companyId).toBe(company.id);
    expect(await t.select(memberships)).toHaveLength(1);
    const identities = await rawDb(testDb.handle).select().from(userIdentities);
    expect(identities.find((i) => i.userId === owner.user.id)).toMatchObject({
      provider: 'fake',
      issuer: FAKE_ISSUER,
    });
  });

  it('takes the slug, name, status, organization and owner it is given, and never repeats itself', async () => {
    const seeded = await seedCompany(testDb.handle, {
      slug: 'acme',
      name: 'Acme',
      status: 'provisioning',
      identityOrgId: 'org_acme',
      owner: {
        email: 'Olga@Acme.test',
        displayName: 'Olga',
        provider: 'clerk',
        issuer: 'https://clerk.test',
        subject: 'user_olga',
      },
    });
    expect(seeded.company).toMatchObject({
      slug: 'acme',
      name: 'Acme',
      status: 'provisioning',
      identityOrgId: 'org_acme',
    });
    expect(seeded.owner.user).toMatchObject({ primaryEmail: 'olga@acme.test', displayName: 'Olga' });
    const other = await seedCompany(testDb.handle);
    expect(other.company.id).not.toBe(seeded.company.id);
    const theirs = (await other.tenant.select(principals)).map((p) => p.id);
    expect(theirs).toEqual([other.owner.principal.id]);
    expect(theirs).not.toContain(seeded.owner.principal.id);
  });

  it('refuses to seed into a deleted company (the tenant layer is the gate)', async () => {
    const error = await seedCompany(testDb.handle, { status: 'deleted' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompanyNotFoundError);
    await expect(tenant(testDb.handle, 'nope')).rejects.toBeInstanceOf(CompanyNotFoundError);
  });
});
