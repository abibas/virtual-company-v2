import type { MiddlewareHandler } from 'hono';
import { BEARER_SCHEME } from '../http/docs.ts';
import { errorJson, errorResponse } from '../http/errors.ts';
import type { AuthEnv } from './actor.ts';
import { type AuthDeps, authn } from './authn.ts';

/**
 * Guards a personal route, `/api/me/...` (after `authn()`), whose rows belong to the caller and to no company (S3.1:
 * subscriptions; later access profiles): only a person signed in to the web app with a session may use it. An API
 * key, which acts in one company and may leak with a laptop, is refused with 403 `session_required`, and so is a run
 * token; a session whose person this server has not linked yet is 403 `user_not_linked` (`GET /api/me` links them).
 * Sets `c.var.userId`, the person whose rows the route reaches (`owned(db, userId)` of `@mwc/db`).
 */
export interface PersonalEnv extends AuthEnv {
  Variables: AuthEnv['Variables'] & { userId: string };
}

export function requireSession(): MiddlewareHandler<PersonalEnv> {
  return async (c, next) => {
    const actor = c.var.actor;
    if (actor === undefined) throw new Error('requireSession() runs after authn()');
    if (actor.via !== 'clerk') {
      return errorJson(
        c,
        403,
        'session_required',
        'This needs you signed in to the web app; an API key cannot manage it',
      );
    }
    if (actor.userId === undefined)
      return errorJson(c, 403, 'user_not_linked', 'Finish signing in first: call GET /api/me once');
    c.set('userId', actor.userId);
    await next();
  };
}

/** `authn()` then `requireSession()`, as a zod-openapi route's `middleware` tuple (so `c.var.userId` is typed). */
export function personalSession(
  deps: AuthDeps,
): [MiddlewareHandler<AuthEnv>, MiddlewareHandler<PersonalEnv>] {
  return [authn(deps), requireSession()];
}

/** A path of the caller's own: what `requireSession` guards. */
export type PersonalPath = `/api/me/${string}`;

/**
 * What every personal route shares (spread `base` into `createRoute`, and `refusals` into its responses): the path
 * (a literal type, for the web's typed client), the tag, the bearer credential and `personalSession(deps)`, and that
 * guard's refusals in the OpenAPI document.
 */
export function personalRoute<P extends PersonalPath>(
  deps: AuthDeps,
  route: { readonly path: P; readonly tag: string },
) {
  return {
    base: {
      path: route.path,
      tags: [route.tag],
      security: [{ [BEARER_SCHEME]: [] }],
      middleware: personalSession(deps),
    },
    refusals: {
      401: errorResponse('No credential, or one that is not valid (`unauthenticated`)'),
      403: errorResponse(
        'An API key (`session_required`), a session with a pending task (`session_pending`), a person not linked ' +
          'yet (`user_not_linked`), or a deactivated account (`user_deactivated`)',
      ),
      503: errorResponse('Sign-in is off on this server (`identity_not_configured`)'),
    },
  };
}
