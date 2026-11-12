import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { LeadWakeSettingsSchema, LeadWakesSchema } from '../schemas/wakes.ts';
import { FlowParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';
import { INVALID, NO_FLOW, route } from './flows.ts';

/**
 * A flow's Lead wake-ups (S6c, docs/processes.md "Built: the Lead wakes up"): `GET …/flows/{flowId}/lead-wakes` (viewer
 * and above) and `PUT` the same (the team's Lead people, admins and owners): which events wake its Lead agent in its
 * team chat, the quiet window, the caps, and how its wake-ups went.
 */

const PATH = '/api/companies/{companyId}/flows/{flowId}/lead-wakes' as const;

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', PATH);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A flow's Lead wake-ups (viewer and above): its settings, its last wake-up and its counts",
    request: { params: FlowParamsSchema },
    responses: { 200: jsonResponse('The wake-ups', LeadWakesSchema), 401: refusals[401], 404: NO_FLOW },
  });
};

const putRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', PATH);
  return createRoute({
    ...base,
    method: 'put',
    summary: "Change a flow's Lead wake-up settings (its Lead people, admins and owners)",
    request: { params: FlowParamsSchema, body: jsonBody(LeadWakeSettingsSchema) },
    responses: {
      200: jsonResponse('The wake-ups', LeadWakesSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse(
        "Below member (`forbidden`), or not one of the team's Lead people nor an admin or owner (`not_lead`)",
      ),
      404: NO_FLOW,
    },
  });
};

export function wakeRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(getRoute(deps), async (c) => {
      const result = await tasks.leadWakes(c.var.tenant, c.req.valid('param').flowId, c.var.clock());
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.wakes, 200);
    })
    .openapi(putRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const settings = c.req.valid('json');
      const result = await tasks.putLeadWakes(c.var.tenant, callerOf(c.var), flowId, settings, c.var.clock());
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.wakes, 200);
    });
}
