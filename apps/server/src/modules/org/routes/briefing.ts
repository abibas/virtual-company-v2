import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { AgentBriefingSchema, AgentParamsSchema } from '../schemas.ts';
import type { OrgService } from '../service.ts';

/**
 * `GET /api/companies/{companyId}/agents/{agentId}/briefing` (viewer and above): the agent's place in the company as its
 * next turn gets it, before its own instructions (docs/harness.md, "Standing instructions"). Read from the live chart
 * on each call; an archived agent's says it is not on the chart.
 */

const briefingRoute = (deps: ServerDeps) => {
  const path = '/api/companies/{companyId}/agents/{agentId}/briefing' as const;
  const { base, refusals } = companyRoute(deps, { role: 'viewer', path, tag: 'agents' });
  return createRoute({
    ...base,
    method: 'get',
    summary: 'What the agent’s turns are told of its place in the company (viewer and above)',
    request: { params: AgentParamsSchema },
    responses: {
      200: jsonResponse('The briefing, generated from the chart', AgentBriefingSchema),
      401: refusals[401],
      404: errorResponse(
        'No such company, or not an active member of it (`not_found`), or no such agent in it (`agent_not_found`)',
      ),
    },
  });
};

export function agentBriefingRoutes(deps: ServerDeps, org: OrgService) {
  return newRouter().openapi(briefingRoute(deps), async (c) => {
    const result = await org.briefing(c.var.tenant, c.req.valid('param').agentId);
    if (!result.ok) return errorJson(c, result.status, result.code, result.message);
    return c.json({ briefing: result.briefing.text, version: result.briefing.version }, 200);
  });
}
