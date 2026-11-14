import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CompanyParamsSchema, DecisionListQuerySchema, DecisionListSchema } from './schemas.ts';
import { listDecisions } from './service.ts';

/**
 * The decision log (2026-11-14): `GET /api/companies/{companyId}/decisions` (members and above), the decisions the
 * company's agents recorded, newest first, by agent, chat, task, contact and outcome, a page at a time. Agents record
 * them with their `record_decision` tool (the chats module's `DecisionsHook`); nobody writes them over HTTP.
 */

const DECISIONS = '/api/companies/{companyId}/decisions' as const;

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: DECISIONS, tag: 'decisions' });
  return createRoute({
    ...base,
    method: 'get',
    summary:
      "The agents' recorded decisions (member and above), newest first, by agent, chat, task, contact or outcome",
    request: { params: CompanyParamsSchema, query: DecisionListQuerySchema },
    responses: {
      200: jsonResponse('A page of decisions', DecisionListSchema),
      400: errorResponse(
        'A filter that is not valid (`invalid_request`), or `before` names no decision (`unknown_before`)',
      ),
      ...refusals,
    },
  });
};

export function decisionsRoutes(deps: ServerDeps) {
  return newRouter().openapi(listRoute(deps), async (c) => {
    const list = await listDecisions(c.var.tenant, c.req.valid('query'));
    if (list === undefined) return errorJson(c, 400, 'unknown_before', 'No such decision to list from');
    return c.json(list, 200);
  });
}
