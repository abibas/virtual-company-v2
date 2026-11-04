import type { VerifyTokenContext } from '@mwc/identity-core';
import { IdentityProviderError } from '@mwc/identity-core';
import type { VerifiedIdentity } from '@mwc/shared/identity';
import type { VerifyTokenFn } from './backend/client.ts';
import { toIdentityError } from './backend/errors.ts';

/** Allowed clock difference for `exp`, `nbf` and `iat`. */
export const CLOCK_SKEW_MS = 5_000;

export interface TokenKeys {
  readonly issuer: string;
  /** Networkless verification with the instance's PEM public key (CLERK_JWT_KEY), when set. */
  readonly jwtKey?: string | undefined;
  /** Otherwise the JWKS, fetched from the Backend API with the secret key (and cached by the SDK). */
  readonly secretKey: string;
}

function stringClaim(claims: Record<string, unknown>, name: string): string | undefined {
  const value = claims[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The active organization of the session: `o.id` (session token v2) or `org_id` (v1). A hint only. */
function activeOrg(claims: Record<string, unknown>): string | undefined {
  const o = claims.o;
  if (typeof o === 'object' && o !== null) {
    const id = (o as Record<string, unknown>).id;
    if (typeof id === 'string' && id !== '') return id;
  }
  return stringClaim(claims, 'org_id');
}

/**
 * Who verified claims say it is: `iss` + `sub` (the identity), `sid`, and `sts` (`pending` while the
 * session has an open task). Organization claims become `activeOrgExternalId`, a UI hint that never
 * authorizes anything.
 */
export function identityFromClaims(claims: Record<string, unknown>, issuer: string): VerifiedIdentity {
  if (claims.iss !== issuer)
    throw new IdentityProviderError('unauthorized', 'clerk: token from another issuer');
  const subject = stringClaim(claims, 'sub');
  if (subject === undefined)
    throw new IdentityProviderError('unauthorized', 'clerk: token without a subject');
  const sessionId = stringClaim(claims, 'sid');
  const org = activeOrg(claims);
  return {
    issuer,
    subject,
    ...(sessionId === undefined ? {} : { sessionId }),
    pending: claims.sts === 'pending',
    ...(org === undefined ? {} : { activeOrgExternalId: org }),
  };
}

/**
 * Verifies a Clerk session token with `@clerk/backend`'s `verifyToken`: signature (the PEM key, else
 * JWKS), issuer, `azp` against the authorized parties (Clerk refuses a token without `azp` when parties
 * are given), and `exp`/`nbf`/`iat` with 5 seconds of clock skew.
 */
export async function verifyClerkToken(
  verify: VerifyTokenFn,
  keys: TokenKeys,
  token: string,
  ctx: VerifyTokenContext,
): Promise<VerifiedIdentity> {
  let claims: Record<string, unknown>;
  try {
    claims = (await verify(token, {
      ...(keys.jwtKey === undefined ? { secretKey: keys.secretKey } : { jwtKey: keys.jwtKey }),
      issuer: keys.issuer,
      authorizedParties: [...ctx.authorizedParties],
      clockSkewInMs: CLOCK_SKEW_MS,
    })) as Record<string, unknown>;
  } catch (error) {
    throw toIdentityError(error, 'verifyAccessToken');
  }
  return identityFromClaims(claims, keys.issuer);
}
