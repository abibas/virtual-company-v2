import { companies } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { getJson } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberView } from '../../../src/modules/members/schemas.ts';
import { type AuthWorld, authWorld, bearer } from '../../fixtures/auth.ts';
import { auditOf, call, outboxOf } from '../../fixtures/companies.ts';
import { addMember, as, memberPath, membersCompany, membershipRow, ROLES } from '../../fixtures/members.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('GET /api/companies/:companyId/members', () => {
  it('lists the members who are not removed, in the order they joined, to every role', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const viewer = await addMember(w, company, 'viewer');
    const suspended = await addMember(w, company, 'member', 'suspended');
    const removed = await addMember(w, company, 'member', 'removed');
    const res = await getJson(w.t.app, company.members, bearer(`fake:${viewer.subject}`));
    expect(res.status).toBe(200);
    const listed = (res.body as { members: MemberView[] }).members;
    expect(listed.map((m) => m.id)).toEqual([
      company.owner.membershipId,
      admin.membershipId,
      viewer.membershipId,
      suspended.membershipId,
    ]);
    const row = await membershipRow(w.t.db, admin.membershipId);
    expect(listed[1]).toEqual({
      id: admin.membershipId,
      userId: admin.userId,
      principalId: admin.principalId,
      displayName: admin.subject,
      email: `${admin.subject}@people.test`,
      imageUrl: null,
      role: 'admin',
      status: 'active',
      joinedAt: row?.createdAt.toISOString(),
    });
    expect(listed[0]).toMatchObject({
      displayName: `Owner ${company.owner.subject}`,
      email: `${company.owner.subject}@owners.test`,
      role: 'owner',
    });
    expect(listed[3]).toMatchObject({ role: 'member', status: 'suspended' });
    expect(listed.map((m) => m.id)).not.toContain(removed.membershipId);
    for (const role of ROLES) {
      const someone = await addMember(w, company, role);
      expect((await as(w, someone)('GET', company.members)).status).toBe(200);
    }
  });

  it('is a 401 without a credential and a 404 for an outsider, a removed member or a deleted company', async () => {
    const company = await membersCompany(w);
    const removed = await addMember(w, company, 'admin', 'removed');
    const other = await membersCompany(w);
    expect(await call(w, undefined)('GET', company.members)).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    for (const caller of [other.owner, removed]) {
      expect(await as(w, caller)('GET', company.members)).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found', message: 'Company not found' } },
      });
    }
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, company.companyId));
    expect((await as(w, company.owner)('GET', company.members)).status).toBe(404);
  });
});

describe('PATCH and DELETE /api/companies/:companyId/members/:membershipId', () => {
  it('are a 401 without a credential and a 404 for an outsider, before the body is read', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    const other = await membersCompany(w);
    const path = memberPath(company, target);
    expect((await call(w, undefined)('PATCH', path, { role: 'admin' })).status).toBe(401);
    expect((await call(w, undefined)('DELETE', path)).status).toBe(401);
    for (const [method, body] of [
      ['PATCH', { role: 'admin' }],
      ['PATCH', {}],
      ['DELETE', undefined],
    ] as const) {
      expect(await as(w, other.owner)(method, path, body)).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found' } },
      });
    }
    expect((await membershipRow(w.t.db, target.membershipId))?.status).toBe('active');
  });

  it("are a 404 member_not_found for an unknown, malformed or removed membership and another company's", async () => {
    const company = await membersCompany(w);
    const removed = await addMember(w, company, 'member', 'removed');
    const other = await membersCompany(w);
    const elsewhere = await addMember(w, other, 'member');
    const ids = [
      '0190f5f0-0000-7000-8000-000000000000',
      'not-an-id',
      removed.membershipId,
      elsewhere.membershipId,
      other.owner.membershipId,
    ];
    for (const id of ids) {
      for (const [method, body] of [
        ['PATCH', { role: 'viewer' }],
        ['DELETE', undefined],
      ] as const) {
        expect(await as(w, company.owner)(method, memberPath(company, id), body)).toMatchObject({
          status: 404,
          body: { error: { code: 'member_not_found', message: 'No such member in this company' } },
        });
      }
    }
    expect((await membershipRow(w.t.db, elsewhere.membershipId))?.role).toBe('member');
    expect((await membershipRow(w.t.db, other.owner.membershipId))?.status).toBe('active');
    expect(await outboxOf(w.t.db, company.companyId)).toEqual([]);
    expect(await outboxOf(w.t.db, other.companyId)).toEqual([]);
  });

  it('refuses a role change by a member or a viewer with 403 and a bad body with 400, writing nothing', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'viewer');
    const path = memberPath(company, target);
    for (const role of ['member', 'viewer'] as const) {
      const caller = await addMember(w, company, role);
      expect(await as(w, caller)('PATCH', path, { role: 'member' })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden', message: 'This needs the admin role or a higher one' } },
      });
    }
    for (const body of [undefined, {}, { role: 'boss' }, { role: null }, { status: 'removed' }]) {
      expect(await as(w, company.owner)('PATCH', path, body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(await membershipRow(w.t.db, target.membershipId)).toMatchObject({
      role: 'viewer',
      grantedRole: 'viewer',
    });
    expect(await outboxOf(w.t.db, company.companyId)).toEqual([]);
    expect(await auditOf(w.t.db, company.companyId)).toEqual([]);
  });
});

describe('the API document', () => {
  it('describes the three member routes under the members tag', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as {
      paths: Record<string, Record<string, { tags: string[]; responses: Record<string, unknown> }>>;
    };
    const list = doc.paths['/api/companies/{companyId}/members'];
    const one = doc.paths['/api/companies/{companyId}/members/{membershipId}'];
    expect(list?.get?.tags).toEqual(['members']);
    expect(Object.keys(list?.get?.responses ?? {})).toEqual(['200', '401', '404']);
    expect(Object.keys(one?.patch?.responses ?? {})).toEqual(['200', '400', '401', '403', '404', '409']);
    expect(Object.keys(one?.delete?.responses ?? {})).toEqual(['204', '401', '403', '404', '409']);
  });
});
