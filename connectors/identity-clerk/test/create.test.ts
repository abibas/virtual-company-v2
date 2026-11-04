import { describe, expect, it } from 'vitest';
import { ClerkConfigError } from '../src/config.ts';
import { clerkIdentityProvider, createClerkIdentityProvider } from '../src/create.ts';
import { ClerkIdentityProvider } from '../src/provider.ts';
import { clerkWorld, SECRET_KEY } from './fixtures/backend.ts';

const HOST = 'test-instance.clerk.accounts.dev';
const env = {
  CLERK_SECRET_KEY: SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`,
};

describe('creating the connector', () => {
  it('from the environment, with the real SDK by default or an injected backend', () => {
    const real = createClerkIdentityProvider(env);
    expect(real).toBeInstanceOf(ClerkIdentityProvider);
    expect(real.issuer).toBe(`https://${HOST}`);
    const { backend } = clerkWorld();
    expect(createClerkIdentityProvider(env, backend).kind).toBe('clerk');
  });

  it('from a checked configuration', () => {
    const provider = clerkIdentityProvider({
      secretKey: SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
      issuer: 'https://x.clerk.accounts.dev',
      frontendApi: 'x.clerk.accounts.dev',
    });
    expect(provider.issuer).toBe('https://x.clerk.accounts.dev');
  });

  it('refuses a bad environment before anything talks to Clerk', () => {
    expect(() => createClerkIdentityProvider({})).toThrow(ClerkConfigError);
  });
});
