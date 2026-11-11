import { createRoute, z } from '@hono/zod-openapi';
import { authn } from '../../platform/auth/authn.ts';
import { type CompanyPath, companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { BEARER_SCHEME, jsonResponse } from '../../platform/http/docs.ts';
import { errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CompanyInboxSchema, InboxCountSchema, MyInboxCountSchema, MyInboxSchema } from './schemas.ts';
import { companyInbox, myInbox } from './service.ts';

/**
 * The inbox (S6b, docs/processes.md "Built in S6b"): what needs the caller now, in one company
 * (`GET /api/companies/{companyId}/inbox`, every active member; a viewer's is empty) or across all of theirs
 * (`GET /api/me/inbox`), each with a count of its own for badges (`…/count`). Read only: the items lead to the task's
 * moves and the chat's answers, which act on them.
 */

const COMPANY = '/api/companies/{companyId}/inbox' as const;
const MINE = '/api/me/inbox' as const;

const ParamsSchema = z.object({
  companyId: z
    .string()
    .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' }),
});

const ORDER =
  'The most urgent first: the task’s priority, then the kind (a Sign-off, a question, another step of yours, an ' +
  'escalation, a block, a turn that ended without a hand-off), then the longest waiting.';

const companyListRoute = <P extends CompanyPath>(deps: ServerDeps, path: P, count: boolean) => {
  const { base, refusals } = companyRoute(deps, { role: 'viewer', path, tag: 'inbox' });
  return createRoute({
    ...base,
    method: 'get',
    summary: count ? 'How many items need you here, for a badge' : 'What needs you in this company now',
    description: count ? 'The length of `GET …/inbox`.' : ORDER,
    request: { params: ParamsSchema },
    responses: {
      200: count
        ? jsonResponse('How many items need you here', InboxCountSchema)
        : jsonResponse('What needs you here, the most urgent first', CompanyInboxSchema),
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const ME_REFUSALS = {
  401: errorResponse('No credential, or one that is not valid (`unauthenticated`)'),
  403: errorResponse(
    'A session with a pending task (`session_pending`), or a deactivated account (`user_deactivated`)',
  ),
  503: errorResponse('Sign-in is off on this server (`identity_not_configured`)'),
};

const myListRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'get',
    path: MINE,
    tags: ['inbox'],
    summary: 'What needs you across your companies now',
    description: `${ORDER} An API key acts in its own company only, so its inbox is that company's.`,
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: authn(deps),
    responses: {
      200: jsonResponse('What needs you, the most urgent first, and how many in each company', MyInboxSchema),
      ...ME_REFUSALS,
    },
  });

const myCountRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'get',
    path: `${MINE}/count`,
    tags: ['inbox'],
    summary: 'How many items need you across your companies, for a badge',
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: authn(deps),
    responses: {
      200: jsonResponse('How many items need you, and in each company', MyInboxCountSchema),
      ...ME_REFUSALS,
    },
  });

export function inboxRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(companyListRoute(deps, COMPANY, false), async (c) => {
      const items = await companyInbox(deps, c.var.tenant, c.var.membership);
      return c.json({ items, count: items.length }, 200);
    })
    .openapi(companyListRoute(deps, `${COMPANY}/count`, true), async (c) => {
      const items = await companyInbox(deps, c.var.tenant, c.var.membership);
      return c.json({ count: items.length }, 200);
    })
    .openapi(myListRoute(deps), async (c) => c.json(await myInbox(deps, c.var.actor), 200))
    .openapi(myCountRoute(deps), async (c) => {
      const { count, companies } = await myInbox(deps, c.var.actor);
      return c.json({ count, companies }, 200);
    });
}
