import type { IdentityProvider } from '@mwc/identity-core';
import type { Context, MiddlewareHandler } from 'hono';
import type { ServerDeps } from '../env.ts';
import { errorJson } from '../http/errors.ts';
import { type AuthEnv, type AuthFailure, type AuthResult, unauthenticated } from './actor.ts';
import { checkApiKey } from './api-keys.ts';
import { classifyBearer, readBearer } from './bearer.ts';
import { checkSession } from './session.ts';

export interface AuthnOptions {
  /** Accept a session with a pending task (Clerk `sts=pending`). Only `GET /api/me` does. */
  readonly allowPending?: boolean;
}

/** What `authn()` reads: the database, MWC_WEB_ORIGIN, the identity provider (none: 503) and the logger. */
export type AuthDeps = Pick<ServerDeps, 'db' | 'config' | 'logger' | 'identity'>;

const NOT_CONFIGURED: AuthFailure = {
  ok: false,
  status: 503,
  code: 'identity_not_configured',
  message: 'Sign-in is not configured on this server (MWC_IDENTITY=none)',
};

function refuse(c: Context<AuthEnv>, failure: AuthFailure) {
  if (failure.status === 401) c.header('www-authenticate', 'Bearer');
  return errorJson(c, failure.status, failure.code, failure.message);
}

function authenticate(
  deps: AuthDeps,
  provider: IdentityProvider,
  token: string,
  now: Date,
  options: AuthnOptions,
): Promise<AuthResult> {
  switch (classifyBearer(token)) {
    case 'api_key':
      return checkApiKey(deps.db, token, now, deps.logger);
    case 'run_token':
      // The typed slot for S4: run tokens are refused until the server signs them.
      return Promise.resolve(unauthenticated('Run tokens are not accepted yet'));
    default:
      return checkSession(deps.db, token, {
        provider,
        webOrigin: deps.config.MWC_WEB_ORIGIN,
        allowPending: options.allowPending ?? false,
      });
  }
}

/**
 * Who is calling: turns `Authorization: Bearer <token>` into `c.var.actor`, from a Clerk session token, a
 * personal API key (`mwc_pk_...`) or, from S4, a run token. Answers 401 `unauthenticated` for a missing,
 * malformed, invalid or expired credential, 403 for a pending session (unless `allowPending`) or a
 * deactivated user, and 503 `identity_not_configured` when the server has no identity provider.
 */
export function authn(deps: AuthDeps, options: AuthnOptions = {}): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (deps.identity === undefined) return refuse(c, NOT_CONFIGURED);
    const token = readBearer(c.req.header('authorization'));
    if (token === null) {
      return refuse(
        c,
        unauthenticated('Sign in first: send Authorization: Bearer <session token or API key>'),
      );
    }
    const result = await authenticate(deps, deps.identity, token, c.var.clock(), options);
    if (!result.ok) return refuse(c, result);
    c.set('actor', result.actor);
    await next();
  };
}
