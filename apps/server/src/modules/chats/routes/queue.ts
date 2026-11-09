import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatTurnSchema, DeliverTurnSchema, EditTurnSchema, TurnParamsSchema } from '../schemas.ts';
import { deliverQueued, discardQueued, editQueued, type QueueDeps } from '../service/queue.ts';

/**
 * A chat's waiting messages (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): `PATCH …/turns/{turnId}`
 * changes one's prompt, `DELETE …/turns/{turnId}` discards it, `POST …/turns/{turnId}/deliver` sends it into the
 * running turn now or makes it interrupt that turn. Only while it waits, and never one already sent Now; a waiting
 * message that cannot start when its turn comes fails with the refusal's words (as the stream says). Admins and owners
 * only.
 */

const ONE = '/api/companies/{companyId}/chats/{chatId}/turns/{turnId}' as const;
const DELIVER = '/api/companies/{companyId}/chats/{chatId}/turns/{turnId}/deliver' as const;

const NOT_FOUND = errorResponse('No such chat (`chat_not_found`) or turn (`turn_not_found`)');
const NOT_WAITING =
  'The chat is archived (`chat_archived`), the message no longer waits (`turn_not_queued`: it started or ended), or ' +
  'it went into the running turn already (`message_sent`)';

const editRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: ONE, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Change a waiting message's prompt (admin and above)",
    request: { params: TurnParamsSchema, body: jsonBody(EditTurnSchema) },
    responses: {
      200: jsonResponse('The waiting turn, changed', ChatTurnSchema),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): a prompt of 1–20 000 characters',
      ),
      ...refusals,
      404: NOT_FOUND,
      409: errorResponse(NOT_WAITING),
    },
  });
};

const discardRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: ONE, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Discard a waiting message (admin and above); the stream says `removed`',
    request: { params: TurnParamsSchema },
    responses: {
      204: { description: 'Discarded' },
      ...refusals,
      404: NOT_FOUND,
      409: errorResponse(NOT_WAITING),
    },
  });
};

const deliverRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: DELIVER, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary:
      'Send a waiting message into the running turn now, or make it interrupt that turn (admin and above)',
    description:
      'Now: Claude Code takes it at its next step, and it starts first if the turn ends without taking it. Interrupt: ' +
      'the running turn stops, and it starts first. With nothing running it starts at once.',
    request: { params: TurnParamsSchema, body: jsonBody(DeliverTurnSchema) },
    responses: {
      202: jsonResponse('The turn: waiting with its new delivery, or running', ChatTurnSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`): `now` or `interrupt`'),
      ...refusals,
      404: NOT_FOUND,
      409: errorResponse(`${NOT_WAITING}; the running turn takes no message now (\`now_unsupported\`)`),
    },
  });
};

export function queueRoutes(deps: ServerDeps & QueueDeps) {
  return newRouter()
    .openapi(editRoute(deps), async (c) => {
      const { chatId, turnId } = c.req.valid('param');
      const result = await editQueued(deps, c.var.tenant, chatId, turnId, c.req.valid('json').prompt);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.json(result.turn, 200);
    })
    .openapi(discardRoute(deps), async (c) => {
      const { chatId, turnId } = c.req.valid('param');
      const result = await discardQueued(deps, c.var.tenant, chatId, turnId);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.body(null, 204);
    })
    .openapi(deliverRoute(deps), async (c) => {
      const { chatId, turnId } = c.req.valid('param');
      const { delivery } = c.req.valid('json');
      const result = await deliverQueued(deps, c.var.tenant, chatId, turnId, delivery);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.json(result.turn, 202);
    });
}
