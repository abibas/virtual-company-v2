import { describe, expect, it } from 'vitest';
import { chooseCompany, keyProblem, keySource, openSession, refusal } from '../../src/api/session.ts';
import type { ActiveLogin } from '../../src/credentials.ts';
import { ACME, fakeApi, KEY, meBody, noFetch, RUNNER_KEY, SERVER } from '../fixtures/account.ts';

const BETA = { ...ACME, companyId: '019a4f0c-9999-7000-8000-000000000002', slug: 'beta', name: 'Beta' };
const HINT = '--company <slug>';

const fromEnv: ActiveLogin = { server: SERVER, key: KEY, source: 'env' };
const saved = (companyId: string, key = KEY): ActiveLogin => ({
  server: SERVER,
  key,
  source: 'file',
  saved: { server: SERVER, companyId, companySlug: 'x', key },
});

describe('chooseCompany', () => {
  it('takes the company named by slug or id', () => {
    expect(chooseCompany([ACME, BETA], 'beta', undefined, HINT)).toEqual({ ok: true, value: BETA });
    expect(chooseCompany([ACME, BETA], ACME.companyId, BETA.companyId, HINT)).toEqual({
      ok: true,
      value: ACME,
    });
  });

  it("takes the saved login's company, else the only one", () => {
    expect(chooseCompany([ACME, BETA], undefined, BETA.companyId, HINT)).toEqual({ ok: true, value: BETA });
    expect(chooseCompany([ACME], undefined, 'gone', HINT)).toEqual({ ok: true, value: ACME });
  });

  it('refuses with the slugs: none named among several, a name that matches none, or no company at all', () => {
    expect(chooseCompany([ACME, BETA], undefined, undefined, 'the company argument')).toEqual({
      ok: false,
      message: 'this key reaches several companies (acme, beta); choose one with the company argument',
    });
    expect(chooseCompany([ACME, BETA], 'globex', undefined, HINT)).toEqual({
      ok: false,
      message: 'no company "globex" for this key; it can reach acme, beta',
    });
    expect(chooseCompany([], 'acme', undefined, HINT)).toEqual({
      ok: false,
      message: "the key's company is not available any more (deleted, or you are no longer a member)",
    });
  });
});

describe('the key and the refusals', () => {
  it('says where a key came from and whether it is a personal one', () => {
    expect(keySource(fromEnv)).toBe('from MWC_API_KEY');
    expect(keySource(saved('c'))).toBe('saved by mwc login');
    expect(keyProblem(fromEnv)).toBeUndefined();
    expect(keyProblem(saved('c', RUNNER_KEY))).toBe(
      'the key saved by mwc login is not a personal API key (mwc_pk_ and 32 letters or digits)',
    );
  });

  it('words a 401 as a refused key and passes any other message on', () => {
    expect(refusal(SERVER, { ok: false, status: 401, code: 'unauthenticated', message: 'Expired' })).toBe(
      `${SERVER} refused the key (Expired). Make a new key and run mwc login again.`,
    );
    expect(
      refusal(SERVER, { ok: false, status: 404, code: 'company_not_found', message: 'Company not found' }),
    ).toBe('Company not found');
  });
});

describe('openSession', () => {
  it("checks the key with GET /api/me and opens the saved login's company", async () => {
    const api = fakeApi({ [KEY]: { status: 200, body: meBody(ACME, [ACME, BETA]) } });
    const opened = await openSession(api.fetch, saved(BETA.companyId), { hint: HINT });
    expect(opened).toEqual({
      ok: true,
      value: { server: SERVER, key: KEY, me: meBody(ACME, [ACME, BETA]), company: BETA },
    });
  });

  it('refuses a key that is not personal before calling, a refused key, and a company it cannot choose', async () => {
    expect(await openSession(noFetch, saved('c', RUNNER_KEY), { hint: HINT })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/is not a personal API key/),
    });
    expect(await openSession(fakeApi({}).fetch, fromEnv, { hint: HINT })).toEqual({
      ok: false,
      message: `${SERVER} refused the key (The API key is not valid). Make a new key and run mwc login again.`,
    });
    expect(await openSession(fakeApi().fetch, fromEnv, { company: 'beta', hint: HINT })).toEqual({
      ok: false,
      message: 'no company "beta" for this key; it can reach acme',
    });
  });
});
