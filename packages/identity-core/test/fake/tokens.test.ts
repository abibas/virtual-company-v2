import { VerifiedIdentity } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_SKEW_MS, FAKE_ISSUER, FakeIdentityProvider, parseFakeToken } from '../../src/fake.ts';
import { ctx, providerError } from '../fixtures/provider.ts';
import { T0, world } from '../fixtures/world.ts';

describe('FakeIdentityProvider: tokens', () => {
  it.each([
    ['fake:u1', { pending: false }],
    ['fake:u1;org=org_9', { pending: false, activeOrgExternalId: 'org_9' }],
    ['fake:u1;pending', { pending: true }],
    ['fake:u1;org=org_9;pending', { pending: true, activeOrgExternalId: 'org_9' }],
    ['fake:u1;pending;org=org_9', { pending: true, activeOrgExternalId: 'org_9' }],
  ])('verifies %s', async (token, expected) => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    const identity = await fake.verifyAccessToken(token, ctx);
    expect(identity).toEqual({ issuer: FAKE_ISSUER, subject: 'u1', sessionId: 'sess_u1', ...expected });
    expect(VerifiedIdentity.parse(identity)).toEqual(identity);
  });

  it.each([
    ['an empty token', ''],
    ['a bearer token of another kind', 'eyJhbGciOiJSUzI1NiJ9.e30.sig'],
    ['the prefix alone', 'fake:'],
    ['an unknown subject', 'fake:u404'],
    ['an empty organization', 'fake:u1;org='],
    ['an unknown part', 'fake:u1;admin'],
    ['a deleted user', 'fake:gone'],
  ])('refuses %s as unauthorized', async (_label, token) => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    fake.createUser({ subject: 'gone', email: 'gone@x.test' });
    fake.deleteUser('gone');
    expect((await providerError(() => fake.verifyAccessToken(token, ctx))).code).toBe('unauthorized');
  });
});

describe('FakeIdentityProvider: token claims', () => {
  const origin = ctx.authorizedParties[0] as string;

  it('reads every part, in any order', () => {
    expect(parseFakeToken(`fake:u1;exp=${T0};sid=s_2;azp=${origin};iss=${FAKE_ISSUER};nbf=1;org=o`)).toEqual({
      subject: 'u1',
      pending: false,
      expiresAt: T0,
      sessionId: 's_2',
      authorizedParty: origin,
      issuer: FAKE_ISSUER,
      notBefore: 1,
      org: 'o',
    });
  });

  it.each([
    ['its own session id', 'fake:u1;sid=sess_42', { sessionId: 'sess_42' }],
    ['its own issuer', `fake:u1;iss=${FAKE_ISSUER}`, {}],
    ['an authorized party', `fake:u1;azp=${origin}`, {}],
    ['an expiry within the clock skew', `fake:u1;exp=${T0 - FAKE_CLOCK_SKEW_MS}`, {}],
    ['a not-before within the clock skew', `fake:u1;nbf=${T0 + FAKE_CLOCK_SKEW_MS}`, {}],
  ])('accepts %s', async (_label, token, expected) => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    expect(await fake.verifyAccessToken(token, ctx)).toEqual({
      issuer: FAKE_ISSUER,
      subject: 'u1',
      sessionId: 'sess_u1',
      pending: false,
      ...expected,
    });
  });

  it('accepts any authorized party when the caller names none', async () => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    const identity = await fake.verifyAccessToken('fake:u1;azp=https://other.test', {
      authorizedParties: [],
    });
    expect(identity.subject).toBe('u1');
  });

  it.each([
    ['another issuer', 'fake:u1;iss=https://issuer.other.test', 'token from another issuer'],
    ['another origin', 'fake:u1;azp=https://evil.test', 'token for another origin'],
    ['an expired token', `fake:u1;exp=${T0 - FAKE_CLOCK_SKEW_MS - 1}`, 'token expired'],
    ['a token not active yet', `fake:u1;nbf=${T0 + FAKE_CLOCK_SKEW_MS + 1}`, 'token not active yet'],
    ['an expiry that is not a number', 'fake:u1;exp=soon', 'unknown token part "exp=soon"'],
    ['an empty session id', 'fake:u1;sid=', 'unknown token part "sid="'],
    ['an inherited name', 'fake:u1;constructor=x', 'unknown token part "constructor=x"'],
  ])('refuses %s', async (_label, token, message) => {
    const { fake } = world();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    const error = await providerError(() => fake.verifyAccessToken(token, ctx));
    expect(error).toMatchObject({ code: 'unauthorized', message: `fake: ${message}` });
  });

  it('checks the expiry against its own clock, which moves', async () => {
    let now = T0;
    const fake = new FakeIdentityProvider({ clock: () => new Date(now) });
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    const token = `fake:u1;exp=${T0 + 60_000}`;
    expect((await fake.verifyAccessToken(token, ctx)).subject).toBe('u1');
    now = T0 + 60_000 + FAKE_CLOCK_SKEW_MS + 1;
    expect((await providerError(() => fake.verifyAccessToken(token, ctx))).message).toBe(
      'fake: token expired',
    );
  });
});
