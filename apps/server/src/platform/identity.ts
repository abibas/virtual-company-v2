import { createClerkIdentityProvider } from '@mwc/identity-clerk';
import type { IdentityProvider } from '@mwc/identity-core';
import type { Config } from '@mwc/shared/config';

/**
 * The identity provider the configuration asks for: the Clerk connector for MWC_IDENTITY=clerk (its keys are
 * checked here, at startup, and a bad one fails with the variable's name, never its value; the webhook signing
 * secret is optional and turns its `webhooks` capability on), nothing for `none`. This is where the connector is
 * wired; modules only see the `IdentityProvider` port.
 */
export function identityFromConfig(config: Config): IdentityProvider | undefined {
  if (config.MWC_IDENTITY !== 'clerk') return undefined;
  return createClerkIdentityProvider({
    CLERK_SECRET_KEY: config.CLERK_SECRET_KEY,
    CLERK_PUBLISHABLE_KEY: config.CLERK_PUBLISHABLE_KEY,
    CLERK_JWT_KEY: config.CLERK_JWT_KEY,
    CLERK_WEBHOOK_SIGNING_SECRET: config.CLERK_WEBHOOK_SIGNING_SECRET,
  });
}
