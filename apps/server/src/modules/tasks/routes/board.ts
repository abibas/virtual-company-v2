import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { BoardQuerySchema, BoardSchema } from '../schemas/board.ts';
import { FlowTextSchema } from '../schemas/flows.ts';
import { FlowParamsSchema } from '../schemas.ts';
import type { TasksService } from '../service.ts';
import { INVALID, NO_FLOW, route } from './flows.ts';

/**
 * A flow's two read models (S5.3a, viewer and above): its written form (`GET …/flows/{flowId}/text`, the text table of
 * docs/processes.md that the web, `mwc flow show` and the agents read alike) and its board (`GET …/flows/{flowId}/board`).
 */

const FLOW = '/api/companies/{companyId}/flows/{flowId}' as const;

const textRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${FLOW}/text`);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A flow's written form (viewer and above): its steps as the text table people and agents read",
    request: { params: FlowParamsSchema },
    responses: { 200: jsonResponse('The text', FlowTextSchema), 401: refusals[401], 404: NO_FLOW },
  });
};

const boardRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${FLOW}/board`);
  return createRoute({
    ...base,
    method: 'get',
    summary:
      "A flow's board (viewer and above): Queued, each step, Done (the latest `done`, 10 by default), Escalated",
    request: { params: FlowParamsSchema, query: BoardQuerySchema },
    responses: {
      200: jsonResponse('The board', BoardSchema),
      400: INVALID,
      401: refusals[401],
      404: NO_FLOW,
    },
  });
};

export function boardRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(textRoute(deps), async (c) => {
      const result = await tasks.flowText(c.var.tenant, c.req.valid('param').flowId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ text: result.text }, 200);
    })
    .openapi(boardRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const result = await tasks.board(c.var.tenant, flowId, c.req.valid('query').done);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.board, 200);
    });
}
