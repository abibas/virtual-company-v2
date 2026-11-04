import { createRoute } from '@hono/zod-openapi';
import { authn } from '../../platform/auth/authn.ts';
import { companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { BEARER_SCHEME } from '../../platform/http/docs.ts';
import { errorResponse as error, errorJson } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CompanySyncSchema, MeSchema, SyncParamsSchema } from './schemas.ts';
import { reconcileCompany } from './service/sync.ts';
import { meService } from './service.ts';

const meRoute = (deps: ServerDeps) =>
  createRoute({
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

const syncRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'admin',
    path: '/api/companies/{companyId}/sync',
    tag: 'identity',
  });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Sync now: bring the company's members and invitations in line with the identity provider",
    description:
      'Runs the company reconcile at once (the jobs loop runs it periodically): accepted invitations become active ' +
      'members, people the provider no longer has are removed, and acceptances of revoked or expired invitations ' +
      'are undone at the provider through the outbox.',
    request: { params: SyncParamsSchema },
    responses: {
      200: {
        description: 'What the sync did',
        content: { 'application/json': { schema: CompanySyncSchema } },
      },
      401: refusals[401],
      403: refusals[403],
      404: refusals[404],
      503: error('The identity provider is away (`identity_unavailable`)'),
    },
  });
};

/** `GET /api/me` (who is calling, with reconcile on sign-in) and `POST /api/companies/:companyId/sync`. */
export function identityRoutes(deps: ServerDeps) {
  const me = meService(deps);
  return newRouter()
    .openapi(meRoute(deps), async (c) => {
      const result = await me.me(c.var.actor, c.var.clock);
      if (!result.ok && result.status === 401) return errorJson(c, 401, result.code, result.message);
      if (!result.ok) return errorJson(c, 403, result.code, result.message);
      return c.json(result.me, 200);
    })
    .openapi(syncRoute(deps), async (c) => c.json(await reconcileCompany(deps, c.var.tenant.companyId), 200));
}
