import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  AgentPlacementParamsSchema,
  PlacementResultSchema,
  PlacementSchema,
  SetPlacementSchema,
} from '../schemas/placement.ts';
import { agentPlacement, type PlacementCaller, removePlacement, setPlacement } from '../service/placement.ts';

/**
 * `/api/companies/{companyId}/agents/{agentId}/placement` (S4.7): where an agent runs, a machine of the company and a
 * mode. Reading it is for viewers and above; setting and removing it for admins and above. Another company's agent is
 * a 404, as an unknown one.
 */

const PLACEMENT = '/api/companies/{companyId}/agents/{agentId}/placement' as const;
const NO_AGENT = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such agent in it (`agent_not_found`)',
);

const route = (deps: ServerDeps, role: MembershipRole) =>
  companyRoute(deps, { role, path: PLACEMENT, tag: 'agents' });

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Where an agent runs (viewer and above): its default placement, or null',
    request: { params: AgentPlacementParamsSchema },
    responses: {
      200: jsonResponse('Its placement', PlacementResultSchema),
      401: refusals[401],
      404: NO_AGENT,
    },
  });
};

const setRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin');
  return createRoute({
    ...base,
    method: 'put',
    summary: 'Choose where an agent runs (admin and above)',
    description:
      'A machine of this company that is not removed, the mode (`host`: in its home folder on the machine; ' +
      '`container`: a fresh locked-down container per run), its home folder there (absolute; its CLAUDE.md, skills ' +
      'and memory load from it), its Claude configuration folder and worktree root (null: the defaults) and whether ' +
      'its runs ask before a tool outside their rules. Runs use it from S5.',
    request: { params: AgentPlacementParamsSchema, body: jsonBody(SetPlacementSchema) },
    responses: {
      200: jsonResponse('Its placement', PlacementSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      404: NO_AGENT,
      422: errorResponse('No such machine in this company, or a removed one (`machine_not_found`)'),
    },
  });
};

const removeRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin');
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Take away where an agent runs (admin and above)',
    request: { params: AgentPlacementParamsSchema },
    responses: {
      204: { description: 'Removed' },
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), no such agent (`agent_not_found`), or it has no ' +
          'placement (`placement_not_found`)',
      ),
    },
  });
};

const callerOf = (v: { membership: { principalId: string }; requestId: string }): PlacementCaller => ({
  principalId: v.membership.principalId,
  requestId: v.requestId,
});

export function placementRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(getRoute(deps), async (c) => {
      const result = await agentPlacement(c.var.tenant, c.req.valid('param').agentId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ placement: result.placement }, 200);
    })
    .openapi(setRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await setPlacement(c.var.tenant, callerOf(c.var), agentId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.placement, 200);
    })
    .openapi(removeRoute(deps), async (c) => {
      const result = await removePlacement(c.var.tenant, callerOf(c.var), c.req.valid('param').agentId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
