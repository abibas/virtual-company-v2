import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * A local RSA key pair standing in for a Clerk instance's signing key, so the real `verifyToken` of
 * `@clerk/backend` runs networklessly (CLERK_JWT_KEY) in the unit tests.
 */
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const PUBLIC_PEM = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export interface TokenOptions {
  /** Sign with a key the instance does not know. */
  readonly foreignKey?: boolean;
}

/** An RS256 session token with Clerk's header (`kid`, `typ: JWT`) and the given claims. */
export function signToken(claims: Record<string, unknown>, options: TokenOptions = {}): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_test_key' }));
  const body = base64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  const key = options.foreignKey ? other.privateKey : pair.privateKey;
  return `${header}.${body}.${base64url(signer.sign(key))}`;
}

/** Claims of a valid session token issued now, for `subject`, to `azp`. */
export function sessionClaims(
  issuer: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    sub: 'user_1',
    sid: `sess_${randomBytes(4).toString('hex')}`,
    azp: 'http://localhost:9951',
    iat: now,
    nbf: now - 10,
    exp: now + 60,
    v: 2,
    ...overrides,
  };
}
