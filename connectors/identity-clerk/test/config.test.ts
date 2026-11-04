import { describe, expect, it, vi } from 'vitest';
import { ClerkConfigError, clerkConfigFromEnv, frontendApiFromPublishableKey } from '../src/config.ts';
import { PUBLIC_PEM } from './fixtures/jwt.ts';

const HOST = 'test-instance.clerk.accounts.dev';
const PUBLISHABLE = `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`;
const SECRET = `sk_test_${'A1'.repeat(20)}`;
const base = { CLERK_SECRET_KEY: SECRET, CLERK_PUBLISHABLE_KEY: PUBLISHABLE };

function configError(env: Record<string, string | undefined>): ClerkConfigError {
  try {
    clerkConfigFromEnv(env);
  } catch (error) {
    if (error instanceof ClerkConfigError) return error;
    throw error;
  }
  throw new Error('expected a ClerkConfigError');
}

describe('clerkConfigFromEnv', () => {
  it('derives the issuer and the Frontend API from the publishable key', () => {
    expect(clerkConfigFromEnv(base)).toEqual({
      secretKey: SECRET,
      publishableKey: PUBLISHABLE,
      issuer: `https://${HOST}`,
      frontendApi: HOST,
    });
  });

  it('takes the optional PEM key (with escaped newlines) and webhook secret; empty means unset', () => {
    const escaped = PUBLIC_PEM.trim().replaceAll('\n', '\\n');
    const config = clerkConfigFromEnv({
      ...base,
      CLERK_JWT_KEY: escaped,
      CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_c2VjcmV0',
    });
    expect(config.jwtKey).toBe(PUBLIC_PEM.trim());
    expect(config.webhookSigningSecret).toBe('whsec_c2VjcmV0');
    const empty = clerkConfigFromEnv({ ...base, CLERK_JWT_KEY: '', CLERK_WEBHOOK_SIGNING_SECRET: '' });
    expect(empty).not.toHaveProperty('jwtKey');
    expect(empty).not.toHaveProperty('webhookSigningSecret');
  });

  it('lists every problem by variable name and never echoes a value', () => {
    const leaked = `sk_live_short`;
    const error = configError({
      CLERK_SECRET_KEY: leaked,
      CLERK_JWT_KEY: 'not a pem',
      CLERK_WEBHOOK_SIGNING_SECRET: 'nope',
    });
    expect(error.issues.map((issue) => issue.split(':')[0])).toEqual([
      'CLERK_SECRET_KEY',
      'CLERK_PUBLISHABLE_KEY',
      'CLERK_JWT_KEY',
      'CLERK_WEBHOOK_SIGNING_SECRET',
    ]);
    expect(error.message).toMatch(/^Invalid Clerk configuration:\n {2}CLERK_SECRET_KEY: /);
    expect(error.message).not.toContain(leaked);
    expect(error.message).not.toContain('not a pem');
  });

  it('refuses a publishable key that encodes no host', () => {
    const bad = `pk_test_${Buffer.from('no-dollar').toString('base64')}`;
    expect(configError({ ...base, CLERK_PUBLISHABLE_KEY: bad }).issues).toEqual([
      'CLERK_PUBLISHABLE_KEY: does not encode a Frontend API host',
    ]);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('CLERK_SECRET_KEY', SECRET);
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', PUBLISHABLE);
    vi.stubEnv('CLERK_JWT_KEY', '');
    vi.stubEnv('CLERK_WEBHOOK_SIGNING_SECRET', '');
    try {
      expect(clerkConfigFromEnv().issuer).toBe(`https://${HOST}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('frontendApiFromPublishableKey', () => {
  it('decodes the host, and answers null for anything else', () => {
    expect(frontendApiFromPublishableKey(PUBLISHABLE)).toBe(HOST);
    expect(frontendApiFromPublishableKey('pk_test_')).toBeNull();
    expect(frontendApiFromPublishableKey('pk')).toBeNull();
    expect(
      frontendApiFromPublishableKey(`pk_test_${Buffer.from('not a host$').toString('base64')}`),
    ).toBeNull();
  });
});
