import { memberships } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { getJson, seedCompany } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanyView } from '../../../../src/modules/companies/schemas.ts';
import { type AuthWorld, addPerson, authWorld, bearer } from '../../../fixtures/auth.ts';
import {
  addUser,
  auditFields,
  auditOf,
  call,
  companyRow,
  createCompany,
  joinCompany,
  outboxOf,
} from '../../../fixtures/companies.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('GET /api/companies/:companyId', () => {
  it('shows the company to a member and above, 403 to a viewer, 404 to anyone else, 401 without a credential', async () => {
    const seeded = await seedCompany(w.t.db, { name: 'Readable', identityOrgId: 'org_readable' });
    const id = seeded.company.id;
    const member = await addPerson(w.t.db, w.fake, id, { role: 'member' });
    const viewer = await addPerson(w.t.db, w.fake, id, { role: 'viewer' });
    const res = await getJson(w.t.app, `/api/companies/${id}`, bearer(`fake:${member.subject}`));
    expect(res).toMatchObject({
      status: 200,
      body: {
        id,
        slug: seeded.company.slug,
        name: 'Readable',
        status: 'active',
        identityOrgId: 'org_readable',
      },
    });
    expect((res.body as CompanyView).createdAt).toBe(seeded.company.createdAt.toISOString());
    expect(await getJson(w.t.app, `/api/companies/${id}`, bearer(`fake:${viewer.subject}`))).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    const other = await seedCompany(w.t.db);
    const outsider = await addPerson(w.t.db, w.fake, other.company.id, { role: 'owner' });
    for (const path of [
      `/api/companies/${id}`,
      '/api/companies/not-an-id',
      '/api/companies/0190f5f0-0000-7000-8000-000000000000',
    ]) {
      expect(await getJson(w.t.app, path, bearer(`fake:${outsider.subject}`))).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found', message: 'Company not found' } },
      });
    }
    expect((await getJson(w.t.app, `/api/companies/${id}`)).status).toBe(401);
  });
});

describe('PATCH /api/companies/:companyId', () => {
  it('renames and re-slugs for an admin, one audit row per changed field, none for an unchanged one', async () => {
    const owner = await addUser(w.t.db, w.fake);
    const company = await createCompany(w, owner.token, { name: 'Patchable' });
    const admin = await addUser(w.t.db, w.fake);
    const { principalId } = await joinCompany(w.t.db, company.id, admin.userId, 'admin');
    const patch = call(w, admin.token, 'req-patch-1');
    const res = await patch('PATCH', `/api/companies/${company.id}`, {
      name: ' Patched ',
      slug: 'patched-co',
    });
    expect(res).toMatchObject({ status: 200, body: { id: company.id, name: 'Patched', slug: 'patched-co' } });
    const row = { companyId: company.id, entityType: 'company', entityId: company.id, action: 'update' };
    const actor = { actorKind: 'user', actorPrincipalId: principalId, requestId: 'req-patch-1' };
    const updates = async () =>
      auditFields(await auditOf(w.t.db, company.id)).filter((r) => r.action === 'update');
    expect(await updates()).toEqual([
      { ...row, ...actor, field: 'name', oldValue: 'Patchable', newValue: 'Patched' },
      { ...row, ...actor, field: 'slug', oldValue: 'patchable', newValue: 'patched-co' },
    ]);
    const same = await patch('PATCH', `/api/companies/${company.id}`, {
      name: 'Patched',
      slug: 'patched-co',
    });
    expect(same).toMatchObject({ status: 200, body: { name: 'Patched', slug: 'patched-co' } });
    await patch('PATCH', `/api/companies/${company.id}`, { name: 'Patched Again' });
    expect((await updates()).map((r) => [r.field, r.oldValue, r.newValue])).toEqual([
      ['name', 'Patchable', 'Patched'],
      ['slug', 'patchable', 'patched-co'],
      ['name', 'Patched', 'Patched Again'],
    ]);
    expect((await companyRow(w.t.db, company.id))?.name).toBe('Patched Again');
  });

  it("refuses another company's slug with 409 and writes nothing", async () => {
    const owner = await addUser(w.t.db, w.fake);
    const company = await createCompany(w, owner.token, { name: 'Clash One' });
    const taken = await createCompany(w, owner.token, { name: 'Clash Two' });
    const res = await call(w, owner.token)('PATCH', `/api/companies/${company.id}`, {
      name: 'Renamed',
      slug: taken.slug,
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'slug_taken' } } });
    expect(await companyRow(w.t.db, company.id)).toMatchObject({ name: 'Clash One', slug: 'clash-one' });
    expect((await auditOf(w.t.db, company.id)).filter((r) => r.action === 'update')).toEqual([]);
  });

  it('refuses a member with 403, an outsider with 404 (before the body), a bad body with 400, no credential with 401', async () => {
    const owner = await addUser(w.t.db, w.fake);
    const company = await createCompany(w, owner.token, { name: 'Guarded Patch' });
    const member = await addUser(w.t.db, w.fake);
    await joinCompany(w.t.db, company.id, member.userId, 'member');
    const outsider = await addUser(w.t.db, w.fake);
    await createCompany(w, outsider.token, { name: 'Outsider Patch Co' });
    const path = `/api/companies/${company.id}`;
    expect(await call(w, member.token)('PATCH', path, { name: 'X' })).toMatchObject({ status: 403 });
    expect(await call(w, outsider.token)('PATCH', path, { name: 'X' })).toMatchObject({ status: 404 });
    expect(await call(w, outsider.token)('PATCH', path, {})).toMatchObject({ status: 404 });
    for (const body of [{}, { status: 'deleted' }, { slug: 'Bad Slug' }, { name: '' }]) {
      expect(await call(w, owner.token)('PATCH', path, body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(await call(w, undefined)('PATCH', path, { name: 'X' })).toMatchObject({ status: 401 });
  });
});

describe('DELETE /api/companies/:companyId', () => {
  it('soft-deletes for the owner with the name typed again; the company is a 404 for everyone afterwards', async () => {
    const owner = await addUser(w.t.db, w.fake);
    const company = await createCompany(w, owner.token, { name: 'Doomed Co' });
    const member = await addUser(w.t.db, w.fake);
    await joinCompany(w.t.db, company.id, member.userId, 'member');
    const path = `/api/companies/${company.id}`;
    const wrong = await call(w, owner.token)('DELETE', path, { confirmName: 'doomed co' });
    expect(wrong).toMatchObject({ status: 422, body: { error: { code: 'confirmation_mismatch' } } });
    expect((await companyRow(w.t.db, company.id))?.status).toBe('provisioning');

    const res = await call(w, owner.token, 'req-delete-1')('DELETE', path, { confirmName: ' Doomed Co ' });
    expect(res).toMatchObject({ status: 204, body: null });
    expect(await companyRow(w.t.db, company.id)).toMatchObject({ status: 'deleted', deletedAt: w.clock() });
    const outbox = await outboxOf(w.t.db, company.id);
    expect(outbox.map((r) => [r.op, r.idempotencyKey, r.payload])).toEqual([
      ['create_org', `create_org:${company.id}`, { createdBySubject: owner.subject }],
      ['delete_org', `delete_org:${company.id}`, { orgExternalId: null }],
    ]);
    const [ownerMembership] = await rawDb(w.t.db)
      .select()
      .from(memberships)
      .where(and(eq(memberships.companyId, company.id), eq(memberships.userId, owner.userId)));
    const deletes = auditFields(await auditOf(w.t.db, company.id)).filter((r) => r.action === 'delete');
    const actor = {
      actorKind: 'user',
      actorPrincipalId: ownerMembership?.principalId,
      requestId: 'req-delete-1',
    };
    const row = {
      companyId: company.id,
      entityType: 'company',
      entityId: company.id,
      action: 'delete',
      ...actor,
    };
    expect(deletes).toEqual([
      { ...row, field: 'deletedAt', oldValue: null, newValue: w.clock().toISOString() },
      { ...row, field: 'status', oldValue: 'provisioning', newValue: 'deleted' },
    ]);

    for (const token of [owner.token, member.token]) {
      expect((await getJson(w.t.app, path, bearer(token))).status).toBe(404);
      expect((await call(w, token)('PATCH', path, { name: 'Back' })).status).toBe(404);
      expect((await call(w, token)('DELETE', path, { confirmName: 'Doomed Co' })).status).toBe(404);
      const listed = (await getJson(w.t.app, '/api/companies', bearer(token))).body as {
        companies: { id: string }[];
      };
      expect(listed.companies.map((c) => c.id)).not.toContain(company.id);
    }
  });

  it('records the organization of a provisioned company for delete_org', async () => {
    const seeded = await seedCompany(w.t.db, { name: 'Linked Doomed', identityOrgId: 'org_linked_doomed' });
    const owner = await addPerson(w.t.db, w.fake, seeded.company.id, { role: 'owner' });
    const res = await call(w, `fake:${owner.subject}`)('DELETE', `/api/companies/${seeded.company.id}`, {
      confirmName: 'Linked Doomed',
    });
    expect(res.status).toBe(204);
    expect((await outboxOf(w.t.db, seeded.company.id)).map((r) => r.payload)).toEqual([
      { orgExternalId: 'org_linked_doomed' },
    ]);
  });

  it('refuses an admin with 403, an outsider with 404, a missing confirmation with 400, no credential with 401', async () => {
    const owner = await addUser(w.t.db, w.fake);
    const company = await createCompany(w, owner.token, { name: 'Guarded Delete' });
    const admin = await addUser(w.t.db, w.fake);
    await joinCompany(w.t.db, company.id, admin.userId, 'admin');
    const outsider = await addUser(w.t.db, w.fake);
    const path = `/api/companies/${company.id}`;
    const body = { confirmName: 'Guarded Delete' };
    expect(await call(w, admin.token)('DELETE', path, body)).toMatchObject({ status: 403 });
    expect(await call(w, outsider.token)('DELETE', path, body)).toMatchObject({ status: 404 });
    expect(await call(w, owner.token)('DELETE', path, {})).toMatchObject({ status: 400 });
    expect(await call(w, owner.token)('DELETE', path)).toMatchObject({ status: 400 });
    expect(await call(w, undefined)('DELETE', path, body)).toMatchObject({ status: 401 });
    expect((await companyRow(w.t.db, company.id))?.status).toBe('provisioning');
  });
});
