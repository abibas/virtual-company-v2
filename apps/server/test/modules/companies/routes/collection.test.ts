import { memberships, orgPositions, principals } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, getJson, seedCompany, testConfig } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanyView } from '../../../../src/modules/companies/schemas.ts';
import {
  addUser,
  auditFields,
  auditOf,
  call,
  companyRow,
  createCompany,
  joinCompany,
  type LinkedUser,
  outboxOf,
} from '../../../fixtures/companies/companies.ts';
import { type AuthWorld, addPerson, authWorld, bearer, seedApiKey } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld();
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const post = (token: string | undefined, body: unknown, requestId?: string) =>
  call(w, token, requestId)('POST', '/api/companies', body);

describe('POST /api/companies', () => {
  it('creates a provisioning company with its owner, the outbox create_org call and audit rows, in one go', async () => {
    const res = await post(ihor.token, { name: '  Acme Robotics ' }, 'req-create-1');
    expect(res.status).toBe(201);
    const company = res.body as CompanyView;
    expect(company).toEqual({
      id: expect.any(String),
      slug: 'acme-robotics',
      name: 'Acme Robotics',
      status: 'provisioning',
      identityOrgId: null,
      logo: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await companyRow(w.t.db, company.id)).toMatchObject({
      createdByUserId: ihor.userId,
      identityProvider: 'fake',
      deletedAt: null,
    });
    const [membership] = await rawDb(w.t.db)
      .select()
      .from(memberships)
      .where(eq(memberships.companyId, company.id));
    expect(membership).toMatchObject({
      userId: ihor.userId,
      role: 'owner',
      grantedRole: 'owner',
      status: 'active',
    });
    const [principal] = await rawDb(w.t.db)
      .select()
      .from(principals)
      .where(and(eq(principals.companyId, company.id), eq(principals.id, membership?.principalId ?? '')));
    expect(principal?.kind).toBe('person');
    // The owner is the root of the org chart, with no title yet.
    expect(
      await rawDb(w.t.db).select().from(orgPositions).where(eq(orgPositions.companyId, company.id)),
    ).toMatchObject([{ principalId: principal?.id, reportsToPrincipalId: null, title: null }]);
    expect(await outboxOf(w.t.db, company.id)).toMatchObject([
      {
        op: 'create_org',
        idempotencyKey: `create_org:${company.id}`,
        payload: { createdBySubject: ihor.subject },
        status: 'pending',
        attempts: 0,
        lastError: null,
      },
    ]);
    const actor = { actorKind: 'user', actorPrincipalId: principal?.id, requestId: 'req-create-1' };
    const row = {
      companyId: company.id,
      entityType: 'company',
      entityId: company.id,
      action: 'create',
      oldValue: null,
    };
    expect(auditFields(await auditOf(w.t.db, company.id))).toEqual([
      { ...row, ...actor, field: 'name', newValue: 'Acme Robotics' },
      { ...row, ...actor, field: 'slug', newValue: 'acme-robotics' },
      { ...row, ...actor, field: 'status', newValue: 'provisioning' },
    ]);
  });

  it('derives slugs from the name, and numbers them when one is taken', async () => {
    const slugs = [];
    for (const name of ['Café Über', 'Café Über', 'cafe uber!', '!!!']) {
      slugs.push((await createCompany(w, ihor.token, { name })).slug);
    }
    expect(slugs).toEqual(['cafe-uber', 'cafe-uber-2', 'cafe-uber-3', 'company']);
    const long = await createCompany(w, ihor.token, { name: `${'x'.repeat(70)}` });
    expect(long.slug).toBe('x'.repeat(63));
    expect((await createCompany(w, ihor.token, { name: 'x'.repeat(70) })).slug).toBe(`${'x'.repeat(61)}-2`);
  });

  it('takes a chosen slug, and refuses one that is taken with 409', async () => {
    expect((await createCompany(w, ihor.token, { name: 'Globex', slug: 'globex-hq' })).slug).toBe(
      'globex-hq',
    );
    const res = await post(ihor.token, { name: 'Another Globex', slug: 'globex-hq' });
    expect(res).toMatchObject({
      status: 409,
      body: { error: { code: 'slug_taken', message: expect.any(String) } },
    });
  });

  it('refuses a chosen reserved slug with 422 and creates nothing; a derived one takes its next suffix', async () => {
    for (const slug of ['settings', 'c', 'api', 'sign-in']) {
      const res = await post(ihor.token, { name: 'Reserved Co', slug });
      expect(res).toMatchObject({
        status: 422,
        body: {
          error: {
            code: 'slug_reserved',
            message: `The slug ${slug} is reserved for the app's own pages; choose another one`,
          },
        },
      });
    }
    const mine = (await getJson(w.t.app, '/api/companies', bearer(ihor.token))).body as {
      companies: { name: string }[];
    };
    expect(mine.companies.filter((c) => c.name === 'Reserved Co')).toEqual([]);
    expect((await createCompany(w, ihor.token, { name: 'Settings' })).slug).toBe('settings-2');
    expect((await createCompany(w, ihor.token, { name: 'API' })).slug).toBe('api-2');
  });

  it('refuses a missing or malformed body with 400', async () => {
    for (const body of [
      {},
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'Ok', slug: 'Not A Slug' },
      { name: 'Ok', slug: '-x' },
    ]) {
      expect(await post(ihor.token, body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    const noBody = await w.t.app.request('/api/companies', { method: 'POST', headers: bearer(ihor.token) });
    expect(noBody.status).toBe(400);
  });

  it('refuses no credential with 401, and an API key, a person not linked yet and a pending session with 403', async () => {
    expect(await post(undefined, { name: 'Nope' })).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    const seeded = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, seeded.company.id, { role: 'owner' });
    const { key } = await seedApiKey(w.t.db, {
      companyId: seeded.company.id,
      principalId: person.principalId,
    });
    expect(await post(key, { name: 'By Key' })).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    w.fake.createUser({ subject: 'stranger_unlinked', email: 'stranger@x.test' });
    expect(await post('fake:stranger_unlinked', { name: 'Unlinked' })).toMatchObject({
      status: 403,
      body: { error: { code: 'user_not_linked' } },
    });
    expect(await post(`${ihor.token};pending`, { name: 'Pending' })).toMatchObject({
      status: 403,
      body: { error: { code: 'session_pending' } },
    });
  });

  it('follows the creation policy: allowlist by email, none for nobody', async () => {
    const listed = await addUser(w.t.db, w.fake, 'Listed@Creators.test'.toLowerCase());
    const app = async (config: Partial<typeof testConfig>) =>
      (
        await createTestApp({
          db: w.t.db,
          clock: w.clock,
          identity: w.fake,
          config: { ...testConfig, ...config },
        })
      ).app;
    const allowlist = await app({
      MWC_COMPANY_CREATION: 'allowlist',
      MWC_COMPANY_CREATORS: ['listed@creators.test'],
    });
    const create = (target: typeof allowlist, token: string, name: string) =>
      target.request('/api/companies', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    expect((await create(allowlist, listed.token, 'Listed Co')).status).toBe(201);
    const refused = await create(allowlist, ihor.token, 'Not Listed Co');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'company_creation_not_allowed' } });
    const none = await app({ MWC_COMPANY_CREATION: 'none', MWC_COMPANY_CREATORS: ['listed@creators.test'] });
    const disabled = await create(none, listed.token, 'Nobody Co');
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toMatchObject({ error: { code: 'company_creation_disabled' } });
  });
});

describe('GET /api/companies', () => {
  it('lists my companies with my role, provisioning ones too, as GET /api/me does, and nobody else’s', async () => {
    const me = await addUser(w.t.db, w.fake);
    const mine = await createCompany(w, me.token, { name: 'Mine Provisioning' });
    const other = await seedCompany(w.t.db, { name: 'Viewer Co' });
    await joinCompany(w.t.db, other.company.id, me.userId, 'viewer');
    const removed = await seedCompany(w.t.db, { name: 'Removed From' });
    await joinCompany(w.t.db, removed.company.id, me.userId, 'admin', 'removed');
    const notMine = await seedCompany(w.t.db, { name: 'Not Mine' });
    const res = await getJson(w.t.app, '/api/companies', bearer(me.token));
    expect(res.status).toBe(200);
    const { companies } = res.body as { companies: { id: string }[] };
    expect(companies).toEqual([
      {
        id: mine.id,
        slug: mine.slug,
        name: 'Mine Provisioning',
        status: 'provisioning',
        role: 'owner',
        membershipStatus: 'active',
        logo: null,
      },
      {
        id: other.company.id,
        slug: other.company.slug,
        name: 'Viewer Co',
        status: 'active',
        role: 'viewer',
        membershipStatus: 'active',
        logo: null,
      },
    ]);
    expect(companies.map((c) => c.id)).not.toContain(notMine.company.id);
    const meBody = (await getJson(w.t.app, '/api/me', bearer(me.token))).body as {
      memberships: { companyId: string }[];
    };
    expect(meBody.memberships.map((m) => m.companyId)).toEqual(companies.map((c) => c.id));
  });

  it('shows an API key its own company only, a person not linked yet nothing, and refuses no credential', async () => {
    const seeded = await seedCompany(w.t.db, { name: 'Keyed Co' });
    const person = await addPerson(w.t.db, w.fake, seeded.company.id, { role: 'member' });
    await createCompany(w, `fake:${person.subject}`, { name: 'Elsewhere' });
    const { key } = await seedApiKey(w.t.db, {
      companyId: seeded.company.id,
      principalId: person.principalId,
    });
    const byKey = await getJson(w.t.app, '/api/companies', bearer(key));
    expect((byKey.body as { companies: { id: string }[] }).companies.map((c) => c.id)).toEqual([
      seeded.company.id,
    ]);
    w.fake.createUser({ subject: 'lister_unlinked', email: 'lister@x.test' });
    expect(await getJson(w.t.app, '/api/companies', bearer('fake:lister_unlinked'))).toMatchObject({
      status: 200,
      body: { companies: [] },
    });
    expect((await getJson(w.t.app, '/api/companies')).status).toBe(401);
  });
});
