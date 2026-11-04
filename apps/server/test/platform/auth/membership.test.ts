import { companies } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { getJson, seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireMembership } from '../../../src/platform/auth/membership.ts';
import type { AppEnv } from '../../../src/platform/env.ts';
import { errorHandler } from '../../../src/platform/http/errors.ts';
import { type AuthWorld, addPerson, authWorld, bearer, seedApiKey } from '../../fixtures/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const probe = (companyId: string, role: string, token: string) =>
  getJson(w.t.app, `/api/companies/${companyId}/probe/${role}`, bearer(`fake:${token}`));

const NOT_FOUND = { status: 404, body: { error: { code: 'not_found', message: 'Company not found' } } };

describe('requireMembership: roles', () => {
  it('lets in the exact role and every higher one, and puts the tenant and membership on the context', async () => {
    const { company } = await seedCompany(w.t.db);
    const member = await addPerson(w.t.db, w.fake, company.id, { role: 'member' });
    const owner = await addPerson(w.t.db, w.fake, company.id, { role: 'owner' });
    const exact = await probe(company.id, 'member', member.subject);
    expect(exact).toMatchObject({
      status: 200,
      body: {
        companyId: company.id,
        membership: {
          id: member.membershipId,
          companyId: company.id,
          principalId: member.principalId,
          userId: member.userId,
          role: 'member',
        },
        actor: { kind: 'user', via: 'clerk', userId: member.userId },
      },
    });
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      expect((await probe(company.id, role, owner.subject)).status).toBe(200);
    }
    expect((await probe(company.id, 'viewer', member.subject)).status).toBe(200);
  });

  it.each([
    ['viewer', 'member'],
    ['member', 'admin'],
    ['admin', 'owner'],
  ] as const)('refuses a %s on a route that needs %s with 403', async (role, required) => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id, { role });
    expect(await probe(company.id, required, person.subject)).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden', message: `This needs the ${required} role or a higher one` } },
    });
  });
});

describe('requireMembership: who is not a member gets 404', () => {
  it('for a person of another company, and the same answer as for a company that does not exist', async () => {
    const { company } = await seedCompany(w.t.db);
    const other = await seedCompany(w.t.db);
    const outsider = await addPerson(w.t.db, w.fake, other.company.id, { role: 'owner' });
    const refused = await probe(company.id, 'viewer', outsider.subject);
    const missing = await probe(newId(), 'viewer', outsider.subject);
    expect(refused).toMatchObject(NOT_FOUND);
    expect(missing).toMatchObject(NOT_FOUND);
    expect(refused.body).toEqual({
      error: { ...(missing.body as { error: object }).error, requestId: expect.any(String) },
    });
    expect((await probe('not-a-uuid', 'viewer', outsider.subject)).status).toBe(404);
  });

  it('for a deleted company, even to its owner', async () => {
    const { company } = await seedCompany(w.t.db);
    const owner = await addPerson(w.t.db, w.fake, company.id, { role: 'owner' });
    expect((await probe(company.id, 'viewer', owner.subject)).status).toBe(200);
    await rawDb(w.t.db).update(companies).set({ status: 'deleted' }).where(eq(companies.id, company.id));
    expect(await probe(company.id, 'viewer', owner.subject)).toMatchObject(NOT_FOUND);
  });

  it.each(['removed', 'suspended', 'invited'] as const)('for a %s membership', async (status) => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id, { role: 'owner', status });
    expect(await probe(company.id, 'viewer', person.subject)).toMatchObject(NOT_FOUND);
  });

  it('for a signed-in person this server has not linked yet', async () => {
    const { company } = await seedCompany(w.t.db);
    w.fake.createUser({ subject: 'stranger_m', email: 'stranger@x.test' });
    expect(await probe(company.id, 'viewer', 'stranger_m')).toMatchObject(NOT_FOUND);
  });

  it('for an API key on a company other than its own', async () => {
    const home = await seedCompany(w.t.db);
    const away = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, home.company.id, { role: 'owner' });
    await addPerson(w.t.db, w.fake, away.company.id, { role: 'owner', subject: `${person.subject}_away` });
    const { key } = await seedApiKey(w.t.db, { companyId: home.company.id, principalId: person.principalId });
    const own = await getJson(w.t.app, `/api/companies/${home.company.id}/probe/owner`, bearer(key));
    expect(own).toMatchObject({
      status: 200,
      body: { actor: { via: 'api_key', companyId: home.company.id } },
    });
    const other = await getJson(w.t.app, `/api/companies/${away.company.id}/probe/viewer`, bearer(key));
    expect(other).toMatchObject(NOT_FOUND);
  });
});

describe('requireMembership: wiring', () => {
  it('is a programming error without authn() in front of it (500)', async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorHandler(w.t.logger));
    app.use(async (c, next) => {
      c.set('requestId', 'req-wiring');
      await next();
    });
    app.get('/api/companies/:companyId/bare', requireMembership({ db: w.t.db }, 'viewer'), (c) =>
      c.text('no'),
    );
    const res = await app.request(`/api/companies/${newId()}/bare`);
    expect(res.status).toBe(500);
  });
});
