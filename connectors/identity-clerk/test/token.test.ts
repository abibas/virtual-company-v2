import { verifyToken } from '@clerk/backend';
import { describe, expect, it, vi } from 'vitest';
import { CLOCK_SKEW_MS, identityFromClaims, verifyClerkToken } from '../src/token.ts';
import { ISSUER, SECRET_KEY } from './fixtures/backend.ts';
import { PUBLIC_PEM, sessionClaims, signToken } from './fixtures/jwt.ts';

const ORIGIN = 'http://localhost:9951';
const keys = { issuer: ISSUER, secretKey: SECRET_KEY, jwtKey: PUBLIC_PEM };
const ctx = { authorizedParties: [ORIGIN] };

/** The real verifier of @clerk/backend, networkless with the PEM key. */
function verify(claims: Record<string, unknown>, options: { foreignKey?: boolean } = {}) {
  return verifyClerkToken(verifyToken, keys, signToken(claims, options), ctx);
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'resolved';
}

describe('verifyClerkToken with the real @clerk/backend verifier', () => {
  it('returns the identity of a valid session token', async () => {
    const claims = sessionClaims(ISSUER, { sid: 'sess_1' });
    expect(await verify(claims)).toEqual({
      issuer: ISSUER,
      subject: 'user_1',
      sessionId: 'sess_1',
      pending: false,
    });
  });

  it('marks a session with a pending task, and keeps org claims as a hint only', async () => {
    const identity = await verify(
      sessionClaims(ISSUER, { sts: 'pending', o: { id: 'org_1', rol: 'admin' } }),
    );
    expect(identity).toMatchObject({ pending: true, activeOrgExternalId: 'org_1' });
    expect(await verify(sessionClaims(ISSUER, { sts: 'active', org_id: 'org_2' }))).toMatchObject({
      pending: false,
      activeOrgExternalId: 'org_2',
    });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.clerk.accounts.dev' }],
    ['another authorized party', { azp: 'https://evil.example' }],
    ['no authorized party', { azp: undefined }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['a token not valid yet', { nbf: Math.floor(Date.now() / 1000) + 30 }],
    ['no subject', { sub: undefined }],
  ])('refuses %s as unauthorized', async (_name, overrides) => {
    expect(await code(verify(sessionClaims(ISSUER, overrides)))).toBe('unauthorized');
  });

  it('allows 5 seconds of clock skew, not more', async () => {
    expect(CLOCK_SKEW_MS).toBe(5_000);
    const now = Math.floor(Date.now() / 1000);
    expect(await code(verify(sessionClaims(ISSUER, { exp: now - 3 })))).toBe('resolved');
    expect(await code(verify(sessionClaims(ISSUER, { nbf: now + 3 })))).toBe('resolved');
    expect(await code(verify(sessionClaims(ISSUER, { exp: now - 8 })))).toBe('unauthorized');
  });

  it('refuses a token signed by another key, and garbage', async () => {
    expect(await code(verify(sessionClaims(ISSUER), { foreignKey: true }))).toBe('unauthorized');
    expect(await code(verifyClerkToken(verifyToken, keys, 'not-a-token', ctx))).toBe('unauthorized');
  });
});

describe('verifyClerkToken: the options it passes', () => {
  it('uses the PEM key when set (networkless), the secret key (JWKS) otherwise', async () => {
    const spy = vi.fn(async () => sessionClaims(ISSUER));
    await verifyClerkToken(spy, keys, 't', ctx);
    await verifyClerkToken(spy, { issuer: ISSUER, secretKey: SECRET_KEY }, 't', ctx);
    expect(spy.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { jwtKey: PUBLIC_PEM, issuer: ISSUER, authorizedParties: [ORIGIN], clockSkewInMs: 5_000 },
      { secretKey: SECRET_KEY, issuer: ISSUER, authorizedParties: [ORIGIN], clockSkewInMs: 5_000 },
    ]);
  });
});

describe('identityFromClaims', () => {
  it('double-checks the issuer and needs a subject', () => {
    expect(() => identityFromClaims({ iss: 'x', sub: 'u' }, ISSUER)).toThrow(/another issuer/);
    expect(() => identityFromClaims({ iss: ISSUER, sub: '' }, ISSUER)).toThrow(/without a subject/);
    expect(identityFromClaims({ iss: ISSUER, sub: 'u', o: { id: '' }, sid: 5 }, ISSUER)).toEqual({
      issuer: ISSUER,
      subject: 'u',
      pending: false,
    });
    expect(identityFromClaims({ iss: ISSUER, sub: 'u', o: null }, ISSUER)).not.toHaveProperty(
      'activeOrgExternalId',
    );
  });
});
