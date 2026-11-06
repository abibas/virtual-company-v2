import { getJson } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanySummary, CompanyView } from '../../../../src/modules/companies/schemas.ts';
import {
  addUser,
  call,
  createCompany,
  joinCompany,
  type LinkedUser,
} from '../../../fixtures/companies/companies.ts';
import {
  deleteLogo,
  getLogo,
  JPEG,
  logoAudit,
  logoRow,
  PNG,
  putLogo,
  sha256,
} from '../../../fixtures/companies/logos.ts';
import { type AuthWorld, authWorld, bearer } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld();
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const version = (bytes: Uint8Array) => ({ version: sha256(bytes).slice(0, 16) });

/** The logo of the company as each response that names it shows it: the company, my list and `GET /api/me`. */
async function logosSeen(token: string, companyId: string) {
  const company = await getJson<CompanyView>(w.t.app, `/api/companies/${companyId}`, bearer(token));
  const list = await getJson<{ companies: CompanySummary[] }>(w.t.app, '/api/companies', bearer(token));
  const me = await getJson<{ memberships: { companyId: string; logo: unknown }[] }>(
    w.t.app,
    '/api/me',
    bearer(token),
  );
  return {
    company: company.body.logo,
    list: list.body.companies.find((c) => c.id === companyId)?.logo,
    me: me.body.memberships.find((m) => m.companyId === companyId)?.logo,
  };
}

describe('the logo version in company responses', () => {
  it('is null for a new company, then the version of each logo set, and null again once it is removed', async () => {
    const company = await createCompany(w, ihor.token, { name: 'Logo Co' });
    expect(company.logo).toBeNull();
    const none = { company: null, list: null, me: null };
    expect(await logosSeen(ihor.token, company.id)).toEqual(none);

    await putLogo(w, ihor.token, company.id, { bytes: PNG });
    const png = version(PNG);
    expect(await logosSeen(ihor.token, company.id)).toEqual({ company: png, list: png, me: png });

    await putLogo(w, ihor.token, company.id, { bytes: JPEG });
    const jpeg = version(JPEG);
    expect(await logosSeen(ihor.token, company.id)).toEqual({ company: jpeg, list: jpeg, me: jpeg });
    const renamed = await call(w, ihor.token)('PATCH', `/api/companies/${company.id}`, {
      name: 'Logo Co Renamed',
    });
    expect(renamed).toMatchObject({ status: 200, body: { name: 'Logo Co Renamed', logo: jpeg } });

    await deleteLogo(w, ihor.token, company.id);
    expect(await logosSeen(ihor.token, company.id)).toEqual(none);
  });

  it("shows each company's own logo in my list", async () => {
    const plain = await createCompany(w, ihor.token, { name: 'Plain Co' });
    const branded = await createCompany(w, ihor.token, { name: 'Branded Co' });
    await putLogo(w, ihor.token, branded.id, { bytes: PNG });
    const list = await getJson<{ companies: CompanySummary[] }>(
      w.t.app,
      '/api/companies',
      bearer(ihor.token),
    );
    const logos = Object.fromEntries(list.body.companies.map((c) => [c.name, c.logo]));
    expect(logos).toMatchObject({ 'Plain Co': null, 'Branded Co': version(PNG) });
    expect(plain.logo).toBeNull();
  });
});

describe('the audit rows of a logo', () => {
  it('records setting, replacing and removing it as the company field logo, by the member, with the request id', async () => {
    const company = await createCompany(w, ihor.token, { name: 'Audited Logo Co' });
    const admin = await addUser(w.t.db, w.fake);
    const { principalId } = await joinCompany(w.t.db, company.id, admin.userId, 'admin');
    await putLogo(w, admin.token, company.id, { bytes: PNG }, { requestId: 'req-logo-1' });
    await putLogo(w, admin.token, company.id, { bytes: PNG }, { requestId: 'req-logo-same' });
    await putLogo(w, admin.token, company.id, { bytes: JPEG }, { requestId: 'req-logo-2' });
    await deleteLogo(w, admin.token, company.id, 'req-logo-3');
    await deleteLogo(w, admin.token, company.id, 'req-logo-none');
    const row = {
      companyId: company.id,
      actorKind: 'user',
      actorPrincipalId: principalId,
      entityType: 'company',
    };
    const change = { entityId: company.id, action: 'update', field: 'logo' };
    expect(await logoAudit(w.t.db, company.id)).toEqual([
      { ...row, ...change, oldValue: null, newValue: sha256(PNG), requestId: 'req-logo-1' },
      { ...row, ...change, oldValue: sha256(PNG), newValue: sha256(JPEG), requestId: 'req-logo-2' },
      { ...row, ...change, oldValue: sha256(JPEG), newValue: null, requestId: 'req-logo-3' },
    ]);
  });
});

describe('a deleted company', () => {
  it('keeps its logo row through a soft delete, and its logo is then a 404 like the company', async () => {
    const company = await createCompany(w, ihor.token, { name: 'Doomed Logo Co' });
    await putLogo(w, ihor.token, company.id, { bytes: PNG });
    const removed = await call(w, ihor.token)('DELETE', `/api/companies/${company.id}`, {
      confirmName: 'Doomed Logo Co',
    });
    expect(removed.status).toBe(204);
    expect(await logoRow(w.t.db, company.id)).toMatchObject({ sha256: sha256(PNG) });
    expect((await getLogo(w, ihor.token, company.id)).status).toBe(404);
    expect((await putLogo(w, ihor.token, company.id, { bytes: JPEG })).status).toBe(404);
  });
});
