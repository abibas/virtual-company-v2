import { IdentityProviderError } from '@mwc/identity-core';
import { FAKE_ISSUER, getJson, LEVEL, seedCompany } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AuthWorld, addPerson, authWorld, bearer, WEB_ORIGIN } from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
let companyId: string;
let subject: string;
beforeAll(async () => {
  w = await authWorld();
  companyId = (await seedCompany(w.t.db)).company.id;
  subject = (await addPerson(w.t.db, w.fake, companyId)).subject;
});
afterAll(() => w.t.close());

const probe = (token: string) => getJson(w.t.app, `/api/companies/${companyId}/probe/viewer`, bearer(token));
const now = () => w.clock().getTime();

describe('session tokens', () => {
  it('accepts a token issued to the web origin, by this issuer, within its lifetime', async () => {
    const token = `fake:${subject};iss=${FAKE_ISSUER};azp=${WEB_ORIGIN};exp=${now() + 60_000};nbf=${now()}`;
    expect((await probe(token)).status).toBe(200);
  });

  it.each([
    ['another issuer', () => `fake:${subject};iss=https://issuer.elsewhere.test`],
    ['another origin (azp)', () => `fake:${subject};azp=https://evil.example`],
    ['an expired token', () => `fake:${subject};exp=${now() - 60_000}`],
    ['a token not valid yet', () => `fake:${subject};nbf=${now() + 60_000}`],
    ['a garbage token', () => 'garbage'],
    ['a token of an unknown person', () => 'fake:nobody_here'],
  ])('refuses %s with 401', async (_label, token) => {
    const res = await probe(token());
    expect(res).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'The session token is not valid or has expired' } },
    });
  });

  it('refuses a verified identity from another issuer than the provider (checked once more here)', async () => {
    vi.spyOn(w.fake, 'verifyAccessToken').mockResolvedValueOnce({
      issuer: 'https://issuer.elsewhere.test',
      subject,
      pending: false,
    });
    expect((await probe(`fake:${subject}`)).status).toBe(401);
  });

  it('refuses a session with a pending task on a company route (403 session_pending)', async () => {
    expect(await probe(`fake:${subject};pending`)).toMatchObject({
      status: 403,
      body: { error: { code: 'session_pending' } },
    });
  });

  it('refuses a deactivated person (403 user_deactivated)', async () => {
    const person = await addPerson(w.t.db, w.fake, companyId, { deactivated: true });
    expect(await probe(`fake:${person.subject}`)).toMatchObject({
      status: 403,
      body: { error: { code: 'user_deactivated' } },
    });
  });
});

describe('session tokens when the provider fails', () => {
  it('answers 503 identity_unavailable while the provider is down', async () => {
    w.fake.failNext('verifyAccessToken');
    const res = await probe(`fake:${subject}`);
    expect(res).toMatchObject({ status: 503, body: { error: { code: 'identity_unavailable' } } });
    expect(res.headers.get('retry-after')).toBeNull();
    expect(
      w.t.logs.some((line) => line.msg === 'identity provider unavailable' && line.level === LEVEL.warn),
    ).toBe(true);
  });

  it("passes on the provider's Retry-After, in seconds, when it is rate limited", async () => {
    w.fake.failNext(
      'verifyAccessToken',
      new IdentityProviderError('rate_limited', 'slow', { retryAfterMs: 2500 }),
    );
    const res = await probe(`fake:${subject}`);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('3');
  });

  it('answers 500 for anything that is not a provider error', async () => {
    w.fake.failNext('verifyAccessToken', new Error('boom'));
    expect(await probe(`fake:${subject}`)).toMatchObject({
      status: 500,
      body: { error: { code: 'internal' } },
    });
  });
});
