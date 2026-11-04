import { type ClerkBackend, clerkBackend } from './backend/client.ts';
import { type ClerkConfig, clerkConfigFromEnv } from './config.ts';
import { ClerkIdentityProvider } from './provider.ts';

/** The connector for a checked configuration; `backend` defaults to the real SDK. */
export function clerkIdentityProvider(config: ClerkConfig, backend?: ClerkBackend): ClerkIdentityProvider {
  return new ClerkIdentityProvider({
    backend: backend ?? clerkBackend(config.secretKey),
    issuer: config.issuer,
    secretKey: config.secretKey,
    jwtKey: config.jwtKey,
    webhookSigningSecret: config.webhookSigningSecret,
  });
}

/** The connector from the environment (`CLERK_*`, docs/clerk-setup.md); the server wires it in S1.4. */
export function createClerkIdentityProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  backend?: ClerkBackend,
): ClerkIdentityProvider {
  return clerkIdentityProvider(clerkConfigFromEnv(env), backend);
}
