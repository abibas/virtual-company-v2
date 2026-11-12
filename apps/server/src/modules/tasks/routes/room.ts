import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { RoomPostSchema, RoomQuerySchema, RoomSchema, RoomSettingsSchema } from '../schemas/room.ts';
import { FlowParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';
import { INVALID, NO_FLOW, route } from './flows.ts';

/**
 * A flow's team room (docs/processes.md "The team room"): `GET …/flows/{flowId}/room` (viewer and above: a page of its
 * feed, who is in it, whether the caller writes there), `POST …/room/messages` (the team's people, admins and owners: a
 * message that asks the team's agents, or those it names with "@") and `PUT …/room` (those who lead the team: its cap
 * on answers an hour).
 */

const ROOM = '/api/companies/{companyId}/flows/{flowId}/room' as const;
const MESSAGES = '/api/companies/{companyId}/flows/{flowId}/room/messages' as const;

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', ROOM);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A flow's team room (viewer and above): its latest messages, or those before `before`",
    request: { params: FlowParamsSchema, query: RoomQuerySchema },
    responses: { 200: jsonResponse('The room', RoomSchema), 400: INVALID, 401: refusals[401], 404: NO_FLOW },
  });
};

const postRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', MESSAGES);
  return createRoute({
    ...base,
    method: 'post',
    summary:
      "Write in a flow's team room (its people, admins and owners); its agents are asked for a turn each",
    request: { params: FlowParamsSchema, body: jsonBody(RoomPostSchema) },
    responses: {
      201: jsonResponse('The room after the message', RoomSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse(
        "Below member (`forbidden`), or not one of the team's people nor an admin or owner (`not_in_team`)",
      ),
      404: NO_FLOW,
    },
  });
};

const putRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', ROOM);
  return createRoute({
    ...base,
    method: 'put',
    summary: "Change a flow's team room cap on answers an hour (its Lead people, admins and owners)",
    request: { params: FlowParamsSchema, body: jsonBody(RoomSettingsSchema) },
    responses: {
      200: jsonResponse('The room', RoomSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse(
        "Below member (`forbidden`), or not one of the team's Lead people nor an admin or owner (`not_lead`)",
      ),
      404: NO_FLOW,
    },
  });
};

export function roomRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(getRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const read = { flowId, query: c.req.valid('query'), now: c.var.clock() };
      const result = await tasks.room(c.var.tenant, callerOf(c.var), read);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.room, 200);
    })
    .openapi(postRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const said = { flowId, body: c.req.valid('json').body, now: c.var.clock() };
      const result = await tasks.say(c.var.tenant, callerOf(c.var), said);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.room, 201);
    })
    .openapi(putRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const change = { flowId, ...c.req.valid('json'), now: c.var.clock() };
      const result = await tasks.putRoomCap(c.var.tenant, callerOf(c.var), change);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.room, 200);
    });
}
