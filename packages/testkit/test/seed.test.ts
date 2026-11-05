import { createHash } from 'node:crypto';
import {
  agents,
  apiKeys,
  CompanyNotFoundError,
  memberships,
  orgPositions,
  principals,
  tenant,
  userIdentities,
} from '@mwc/db';
import { migrateToLatest, rawDb } from '@mwc/db/system';
import { FAKE_ISSUER, FakeIdentityProvider } from '@mwc/identity-core/fake';
import { API_KEY_PATTERN, apiKeyKind } from '@mwc/shared/api-keys';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../src/app.ts';
import { createTestDb, type TestDb } from '../src/db.ts';
import { getJson } from '../src/http.ts';
import { seedAgent, seedApiKey, seedCompany, seedMember } from '../src/seed.ts';

let testDb: TestDb;
/** The API on the same database, for the keys `seedApiKey` makes. */
let api: TestApp;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
  api = await createTestApp({ db: testDb.handle, identity: new FakeIdentityProvider() });
});
afterAll(() => testDb.close());

describe('seedCompany', () => {
  it('makes an active company with its owner: user, identity, person principal, owner membership, root position', async () => {
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
    expect(await t.select(orgPositions)).toEqual([
      expect.objectContaining({ principalId: owner.principal.id, reportsToPrincipalId: null, title: null }),
    ]);
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

  it('seeds agents with their places on the chart, and none for an archived one or reportsTo null', async () => {
    const { company, owner, tenant: t } = await seedCompany(testDb.handle);
    const lead = await seedAgent(testDb.handle, company.id, { reportsTo: owner.principal.id, title: 'Lead' });
    expect(lead.principal).toMatchObject({ companyId: company.id, kind: 'agent' });
    expect(lead.agent).toMatchObject({
      principalId: lead.principal.id,
      roleTitle: 'Coder',
      status: 'active',
      model: 'claude-opus-5-5',
      effort: 'high',
      face: 0,
    });
    expect(lead.agent.slug).toMatch(/^agent-[0-9a-f]{8}$/);
    const helper = await seedAgent(testDb.handle, company.id, {
      reportsTo: lead.principal.id,
      name: 'Helper',
      slug: 'helper',
      face: 7,
    });
    expect(helper.agent).toMatchObject({ name: 'Helper', slug: 'helper', face: 7 });
    const gone = await seedAgent(testDb.handle, company.id, {
      reportsTo: owner.principal.id,
      status: 'archived',
    });
    const loose = await seedAgent(testDb.handle, company.id, { reportsTo: null });
    expect(await t.select(agents)).toHaveLength(4);
    const placed = (await t.select(orgPositions)).map((p) => [
      p.principalId,
      p.reportsToPrincipalId,
      p.title,
    ]);
    expect(placed).toEqual(
      expect.arrayContaining([
        [owner.principal.id, null, null],
        [lead.principal.id, owner.principal.id, 'Lead'],
        [helper.principal.id, lead.principal.id, null],
      ]),
    );
    expect(placed).toHaveLength(3);
    expect(placed.map(([id]) => id)).not.toContain(gone.principal.id);
    expect(placed.map(([id]) => id)).not.toContain(loose.principal.id);
  });

  it('refuses to seed into a deleted company (the tenant layer is the gate)', async () => {
    const error = await seedCompany(testDb.handle, { status: 'deleted' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompanyNotFoundError);
    await expect(tenant(testDb.handle, 'nope')).rejects.toBeInstanceOf(CompanyNotFoundError);
  });
});

describe('seedMember', () => {
  it('adds an active member with a user, a person principal and a place under the manager', async () => {
    const { company, owner, tenant: scoped } = await seedCompany(testDb.handle);
    const bob = await seedMember(testDb.handle, company.id, {
      role: 'admin',
      displayName: 'Bob',
      email: 'Bob@Acme.test',
      reportsTo: owner.principal.id,
      title: 'CTO',
    });
    expect(bob.user).toMatchObject({ primaryEmail: 'bob@acme.test', displayName: 'Bob' });
    expect(bob.principal).toMatchObject({ companyId: company.id, kind: 'person' });
    expect(bob.membership).toMatchObject({
      principalId: bob.principal.id,
      userId: bob.user.id,
      role: 'admin',
      grantedRole: 'admin',
      status: 'active',
    });
    expect(await scoped.select(orgPositions)).toContainEqual(
      expect.objectContaining({
        principalId: bob.principal.id,
        reportsToPrincipalId: owner.principal.id,
        title: 'CTO',
      }),
    );
  });

  it('defaults to a member with unique names, and places nobody for reportsTo null', async () => {
    const { company, tenant: scoped } = await seedCompany(testDb.handle);
    const one = await seedMember(testDb.handle, company.id, { reportsTo: null, status: 'suspended' });
    const two = await seedMember(testDb.handle, company.id, { reportsTo: null });
    expect(one.membership).toMatchObject({ role: 'member', status: 'suspended' });
    expect(one.user.primaryEmail).not.toBe(two.user.primaryEmail);
    expect(one.user.displayName).toMatch(/^Member [0-9a-f]{8}$/);
    expect(await scoped.select(memberships)).toHaveLength(3);
    expect(await scoped.select(orgPositions)).toHaveLength(1);
  });
});

describe('seedApiKey', () => {
  it('stores only the SHA-256 and the prefix of a personal key the server accepts', async () => {
    const { company, owner, tenant: scoped } = await seedCompany(testDb.handle, { slug: 'keyed' });
    const { key, id } = await seedApiKey(testDb.handle, company.id, owner.principal.id);
    expect(key).toMatch(API_KEY_PATTERN);
    expect(apiKeyKind(key)).toBe('personal');
    const [row] = await scoped.select(apiKeys);
    expect(row).toMatchObject({
      id,
      principalId: owner.principal.id,
      kind: 'personal',
      name: 'test key',
      prefix: key.slice(0, 11),
      secretHash: createHash('sha256').update(key).digest('hex'),
      expiresAt: null,
      revokedAt: null,
    });
    const me = await getJson(api.app, '/api/me', { authorization: `Bearer ${key}` });
    expect(me).toMatchObject({
      status: 200,
      body: { memberships: [{ companyId: company.id, slug: 'keyed' }] },
    });
  });

  it('takes a name, an expiry and a revocation, and the server refuses a revoked key', async () => {
    const { company, owner } = await seedCompany(testDb.handle);
    const revokedAt = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const seeded = await seedApiKey(testDb.handle, company.id, owner.principal.id, {
      name: 'ci',
      expiresAt,
      revokedAt,
    });
    const other = await seedApiKey(testDb.handle, company.id, owner.principal.id);
    expect(seeded.key).not.toBe(other.key);
    const me = await getJson(api.app, '/api/me', { authorization: `Bearer ${seeded.key}` });
    expect(me.status).toBe(401);
  });
});
