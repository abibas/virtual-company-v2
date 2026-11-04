import { createRoute } from '@hono/zod-openapi';
import { authn } from '../../platform/auth/authn.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { BEARER_SCHEME } from '../../platform/http/docs.ts';
import { ErrorBodySchema, errorJson } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { MeSchema } from './schemas.ts';
import { meService } from './service.ts';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBodySchema } },
});

/** `GET /api/me`: who is calling, their companies and session, with reconcile on sign-in. */
export function identityRoutes(deps: ServerDeps) {
  const me = meService(deps);
  const meRoute = createRoute({
    method: 'get',
    path: '/api/me',
    tags: ['identity'],
    summary: 'The caller: their user, memberships and session; links a person on sign-in',
    description:
      'Accepts a Clerk session token (also one with a pending task) or a personal API key. The first call of ' +
      'a session reconciles the person and their memberships with the identity provider.',
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: authn(deps, { allowPending: true }),
    responses: {
      200: { description: 'The caller', content: { 'application/json': { schema: MeSchema } } },
      401: error('No credential, or one that is not valid (`unauthenticated`)'),
      403: error('A deactivated account (`user_deactivated`)'),
      503: error(
        'Sign-in is off (`identity_not_configured`) or the provider is away (`identity_unavailable`)',
      ),
    },
  });
  return newRouter().openapi(meRoute, async (c) => {
    const result = await me.me(c.var.actor, c.var.clock);
    if (!result.ok && result.status === 401) return errorJson(c, 401, result.code, result.message);
    if (!result.ok) return errorJson(c, 403, result.code, result.message);
    return c.json(result.me, 200);
  });
}
