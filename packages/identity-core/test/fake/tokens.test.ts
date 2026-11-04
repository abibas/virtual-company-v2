import { VerifiedIdentity } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { FAKE_ISSUER } from '../../src/fake.ts';
import { ctx, providerError } from '../fixtures/provider.ts';
import { world } from '../fixtures/world.ts';

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
