import { ClerkConfigError } from '@mwc/identity-clerk';
import { loadConfig } from '@mwc/shared/config';
import { brokenDb, createTestApp, getJson, testConfig } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import { identityFromConfig } from '../../src/platform/identity.ts';

const HOST = 'wiring-test.clerk.accounts.dev';
const SECRET = `sk_test_${'B2'.repeat(20)}`;
const clerkConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: testConfig.DATABASE_URL,
  CLERK_SECRET_KEY: SECRET,
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`,
});

describe('identityFromConfig', () => {
  it('has no provider when sign-in is off', () => {
    expect(identityFromConfig(testConfig)).toBeUndefined();
  });

  it('wires the Clerk connector for MWC_IDENTITY=clerk, with the issuer its publishable key names', () => {
    const provider = identityFromConfig(clerkConfig);
    expect(provider).toMatchObject({ kind: 'clerk', issuer: `https://${HOST}` });
  });

  it('fails at startup on a malformed key, naming the variable and never its value', () => {
    const bad = { ...clerkConfig, CLERK_SECRET_KEY: 'not-a-key' };
    expect(() => identityFromConfig(bad)).toThrow(ClerkConfigError);
    expect(() => identityFromConfig(bad)).toThrow(/CLERK_SECRET_KEY/);
    expect(() => identityFromConfig(bad)).not.toThrow(/not-a-key/);
  });

  it('is what createApp uses when no provider is passed in (no network: the request has no token)', async () => {
    const t = await createTestApp({ db: brokenDb(), config: clerkConfig });
    expect(await getJson(t.app, '/api/me')).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    const off = await createTestApp({ db: brokenDb() });
    expect((await getJson(off.app, '/api/me')).status).toBe(503);
  });
});
