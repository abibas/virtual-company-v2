import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { OlderTurnsQuerySchema } from '../schemas/history.ts';
import { ChatParamsSchema, OlderTurnsSchema } from '../schemas.ts';
import { olderTurns } from '../service/history.ts';

/**
 * A long chat's older turns (docs/harness.md "Reading a long chat"): `GET /api/companies/{companyId}/chats/{chatId}/turns`
 * pages back through the turns the chat's detail leaves out. Members and above.
 */

const TURNS = '/api/companies/{companyId}/chats/{chatId}/turns' as const;

const olderRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: TURNS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "A chat's older turns with their events, a page at a time (member and above)",
    description:
      'The latest `limit` turns (1–50, default 20) before `beforeSeq` and after `afterSeq` (both exclusive), in order, ' +
      "and `more` when older ones exist in that range. Page back from the detail's `earlier.before` (with `afterSeq` " +
      "one before the last Clear's number, to stay in the current conversation), or load a conversation before a " +
      "Clear with its `clearSeq` and the next older conversation's (0 for the first).",
    request: { params: ChatParamsSchema, query: OlderTurnsQuerySchema },
    responses: {
      200: jsonResponse('The turns', OlderTurnsSchema),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): `beforeSeq` from 1, `afterSeq` from 0, `limit` 1–50',
      ),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
    },
  });
};

export function historyRoutes(deps: ServerDeps) {
  return newRouter().openapi(olderRoute(deps), async (c) => {
    const result = await olderTurns(c.var.tenant, c.req.valid('param').chatId, c.req.valid('query'));
    if (!result.ok) return errorJson(c, 404, result.code, result.message);
    return c.json({ turns: result.turns, more: result.more }, 200);
  });
}
