import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatParamsSchema, ChatTurnSchema } from '../schemas.ts';
import { clearChat, compactChat } from '../service/conversation.ts';
import type { TurnsDeps } from '../service/turns.ts';
import { TURN_REFUSALS } from './turns.ts';

/**
 * A chat's conversation as a whole (S5.2, docs/harness.md "Compact and Clear"): `POST
 * /api/companies/{companyId}/chats/{chatId}/compact` runs the harness's own `/compact` as a turn of kind `compact`, and
 * `POST …/clear` records a Clear and starts the next turn in a new conversation. Admins and owners only.
 */

const COMPACT = '/api/companies/{companyId}/chats/{chatId}/compact' as const;
const CLEAR = '/api/companies/{companyId}/chats/{chatId}/clear' as const;

const NO_CHAT = errorResponse(
  'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
);

const compactRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: COMPACT, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Compact the chat's conversation: the harness's own `/compact`, as a turn (admin and above)",
    description:
      "A turn of kind `compact` with the prompt `/compact`, on the chat's session, refused as any turn is. Its events " +
      'come on the stream: a `compact` event with the size before and after, then the usage and the result (no reply). ' +
      'Claude Code only: a Codex chat is refused (`compact_unsupported`).',
    request: { params: ChatParamsSchema },
    responses: {
      202: jsonResponse('The compaction turn, running', ChatTurnSchema),
      ...refusals,
      404: NO_CHAT,
      409: errorResponse(
        `${TURN_REFUSALS[409]}; the chat has no conversation yet (\`nothing_to_compact\`) or is a Codex chat ` +
          '(`compact_unsupported`)',
      ),
      422: errorResponse(TURN_REFUSALS[422]),
      503: errorResponse(TURN_REFUSALS[503]),
    },
  });
};

const clearRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: CLEAR, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Clear the chat's conversation: its next turn starts a new one (admin and above)",
    description:
      "Runs nothing: forgets the chat's session and records a turn of kind `clear` (prompt `/clear`, done at once, on " +
      'no credential), which the thread shows as a marker and the stream sends as a `turn` message. The old ' +
      "conversation stays on the machine, unused. The chat's `context` and `init` start over after it.",
    request: { params: ChatParamsSchema },
    responses: {
      200: jsonResponse('The Clear turn', ChatTurnSchema),
      ...refusals,
      404: NO_CHAT,
      409: errorResponse(
        'The chat is archived (`chat_archived`), a turn of it runs (`turn_running`), or it has no conversation to ' +
          'clear (`nothing_to_clear`)',
      ),
    },
  });
};

export function conversationRoutes(deps: ServerDeps & TurnsDeps) {
  return newRouter()
    .openapi(compactRoute(deps), async (c) => {
      const caller = { principalId: c.var.membership.principalId };
      const result = await compactChat(deps, c.var.tenant, caller, c.req.valid('param').chatId);
      if (!result.ok)
        return errorJson(c, result.status as 404 | 409 | 422 | 503, result.code, result.message);
      return c.json(result.turn, 202);
    })
    .openapi(clearRoute(deps), async (c) => {
      const caller = { principalId: c.var.membership.principalId };
      const result = await clearChat(deps, c.var.tenant, caller, c.req.valid('param').chatId);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.json(result.turn, 200);
    });
}
