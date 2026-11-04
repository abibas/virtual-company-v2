import { CLERK_SECRET_KEY_PATTERN } from '@mwc/shared/config';
import { z } from 'zod';

/**
 * The Clerk connector's configuration, from the environment (docs/clerk-setup.md). Values are never
 * echoed: a bad one fails with the variable's name and what is wrong, not with the value.
 */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

const ClerkEnv = z.object({
  /** Backend API key: `sk_test_...` (development) or `sk_live_...`. */
  CLERK_SECRET_KEY: z.string().regex(CLERK_SECRET_KEY_PATTERN, 'must look like sk_test_... or sk_live_...'),
  /** Encodes the Frontend API host, which is the issuer of session tokens. */
  CLERK_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_[A-Za-z0-9+/=]+$/, 'must look like pk_test_... or pk_live_...'),
  /** The instance's PEM public key: networkless token verification. Without it, JWKS via the secret key. */
  CLERK_JWT_KEY: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .transform((pem) => pem.replaceAll('\\n', '\n'))
      .refine((pem) => pem.includes('-----BEGIN PUBLIC KEY-----'), 'must be a PEM public key')
      .optional(),
  ),
  /** The webhook endpoint's signing secret (`whsec_...`); webhooks are optional in development. */
  CLERK_WEBHOOK_SIGNING_SECRET: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^whsec_[A-Za-z0-9+/=]+$/, 'must look like whsec_...')
      .optional(),
  ),
});

export interface ClerkConfig {
  readonly secretKey: string;
  readonly publishableKey: string;
  /** `https://<frontend api host>`: the `iss` of every session token of this instance. */
  readonly issuer: string;
  /** The Frontend API host, e.g. `robust-koala-7286.clerk.accounts.dev`. */
  readonly frontendApi: string;
  readonly jwtKey?: string;
  readonly webhookSigningSecret?: string;
}

export class ClerkConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid Clerk configuration:\n${issues.map((issue) => `  ${issue}`).join('\n')}`);
    this.name = 'ClerkConfigError';
    this.issues = issues;
  }
}

/** The Frontend API host a publishable key encodes (`pk_<env>_` + base64 of `<host>$`), or null. */
export function frontendApiFromPublishableKey(publishableKey: string): string | null {
  const encoded = publishableKey.split('_')[2] ?? '';
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : null;
}

/** Reads and checks the Clerk variables; throws `ClerkConfigError` listing every problem, never a value. */
export function clerkConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClerkConfig {
  const parsed = ClerkEnv.safeParse(env);
  if (!parsed.success) {
    throw new ClerkConfigError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
    );
  }
  const { CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_JWT_KEY, CLERK_WEBHOOK_SIGNING_SECRET } =
    parsed.data;
  const frontendApi = frontendApiFromPublishableKey(CLERK_PUBLISHABLE_KEY);
  if (frontendApi === null) {
    throw new ClerkConfigError(['CLERK_PUBLISHABLE_KEY: does not encode a Frontend API host']);
  }
  return {
    secretKey: CLERK_SECRET_KEY,
    publishableKey: CLERK_PUBLISHABLE_KEY,
    issuer: `https://${frontendApi}`,
    frontendApi,
    ...(CLERK_JWT_KEY === undefined ? {} : { jwtKey: CLERK_JWT_KEY }),
    ...(CLERK_WEBHOOK_SIGNING_SECRET === undefined
      ? {}
      : { webhookSigningSecret: CLERK_WEBHOOK_SIGNING_SECRET }),
  };
}
