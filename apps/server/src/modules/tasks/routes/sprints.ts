import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { NewSprintSchema, SprintListSchema, SprintParamsSchema, SprintSchema } from '../schemas/sprints.ts';
import { FlowParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';
import { INVALID, NO_FLOW, route } from './flows.ts';

/**
 * A flow's sprints (T-37): `GET …/flows/{flowId}/sprints` (the list, newest first) and `GET …/sprints/{sprintId}` (one
 * with its report) for viewers and up, and `POST …/flows/{flowId}/sprints` (the team's Lead people, admins and owners),
 * which ends the current sprint and starts the next one with the open tasks carried over.
 */

const SPRINTS = '/api/companies/{companyId}/flows/{flowId}/sprints' as const;
const SPRINT = '/api/companies/{companyId}/flows/{flowId}/sprints/{sprintId}' as const;

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', SPRINTS);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A flow's sprints (viewer and above), newest first, with their dates and counts",
    request: { params: FlowParamsSchema },
    responses: { 200: jsonResponse('The sprints', SprintListSchema), 401: refusals[401], 404: NO_FLOW },
  });
};

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', SPRINT);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'One sprint with its report (viewer and above); the current one shows its report so far',
    request: { params: SprintParamsSchema },
    responses: {
      200: jsonResponse('The sprint', SprintSchema),
      401: refusals[401],
      404: errorResponse(`${NO_FLOW.description}, or no such sprint in it (\`sprint_not_found\`)`),
    },
  });
};

const newRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', SPRINTS);
  return createRoute({
    ...base,
    method: 'post',
    summary:
      "Start the flow's next sprint (its Lead people, admins and owners): the current one ends with its report, open tasks carry over",
    request: { params: FlowParamsSchema, body: jsonBody(NewSprintSchema) },
    responses: {
      201: jsonResponse('The new sprint', SprintSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse(
        "Below member (`forbidden`), or not one of the team's Lead people nor an admin or owner (`not_lead`)",
      ),
      404: NO_FLOW,
    },
  });
};

export function sprintRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const result = await tasks.sprints(c.var.tenant, c.req.valid('param').flowId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ sprints: result.sprints }, 200);
    })
    .openapi(getRoute(deps), async (c) => {
      const result = await tasks.sprint(c.var.tenant, c.req.valid('param'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.sprint, 200);
    })
    .openapi(newRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const { name } = c.req.valid('json');
      const result = await tasks.newSprint(c.var.tenant, callerOf(c.var), {
        flowId,
        name,
        now: c.var.clock(),
      });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.sprint, 201);
    });
}
