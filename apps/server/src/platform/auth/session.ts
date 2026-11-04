import { type DbHandle, userIdentities, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { type IdentityProvider, isIdentityProviderError } from '@mwc/identity-core';
import type { VerifiedIdentity } from '@mwc/shared/identity';
import { and, eq } from 'drizzle-orm';
import { type AuthResult, unauthenticated } from './actor.ts';

export interface SessionCheck {
  readonly provider: IdentityProvider;
  /** The web origin tokens must be issued to (Clerk `azp`): MWC_WEB_ORIGIN. */
  readonly webOrigin: string;
  /** Accept a session with a pending task (Clerk `sts=pending`); only `GET /api/me` does. */
  readonly allowPending: boolean;
}

/** The local user an `(issuer, subject)` is linked to, never found by email. */
async function linkedUser(handle: DbHandle, identity: VerifiedIdentity) {
  const [row] = await rawDb(handle)
    .select({ id: users.id, status: users.status })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.issuer, identity.issuer), eq(userIdentities.subject, identity.subject)));
  return row;
}

/**
 * The caller behind a session token: the provider verifies it (signature, issuer, `azp` against the web
 * origin, `exp`/`nbf` with 5 seconds of skew), the issuer is checked once more here, a pending session is
 * refused unless allowed, and the person is the local user linked to `(issuer, subject)`, if any. A provider
 * that is down rejects with its retryable error (the error handler answers 503).
 */
export async function checkSession(
  handle: DbHandle,
  token: string,
  check: SessionCheck,
): Promise<AuthResult> {
  let identity: VerifiedIdentity;
  try {
    identity = await check.provider.verifyAccessToken(token, { authorizedParties: [check.webOrigin] });
  } catch (error) {
    if (isIdentityProviderError(error) && !error.retryable) {
      return unauthenticated('The session token is not valid or has expired');
    }
    throw error;
  }
  if (identity.issuer !== check.provider.issuer) {
    return unauthenticated('The session token is not valid or has expired');
  }
  if (identity.pending && !check.allowPending) {
    return {
      ok: false,
      status: 403,
      code: 'session_pending',
      message: 'The session has a pending task; finish signing in first',
    };
  }
  const user = await linkedUser(handle, identity);
  if (user?.status === 'deactivated') {
    return { ok: false, status: 403, code: 'user_deactivated', message: 'This account is deactivated' };
  }
  return {
    ok: true,
    actor: {
      kind: 'user',
      via: 'clerk',
      identity,
      ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
      ...(user === undefined ? {} : { userId: user.id }),
    },
  };
}
