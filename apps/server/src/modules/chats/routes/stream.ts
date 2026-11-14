import { createRoute, z } from '@hono/zod-openapi';
import { parseChatEventId } from '@mwc/shared/chats';
import { streamSSE } from 'hono/streaming';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { chatsRepo } from '../repo.ts';
import { CHAT_NOT_FOUND } from '../rules.ts';
import { ChatParamsSchema } from '../schemas.ts';
import { type StreamDeps, streamChat } from '../service/stream.ts';

/**
 * A chat's stream (S5.1b): `GET /api/companies/{companyId}/chats/{chatId}/stream`, Server-Sent Events over a normal
 * authenticated GET (the web reads it with `fetch` and its Bearer header; no cookies). Members and above.
 */

const STREAM = '/api/companies/{companyId}/chats/{chatId}/stream' as const;

const streamRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: STREAM, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "A chat's live turns and events, as Server-Sent Events (member and above)",
    description:
      '`event: turn` with `{turn}` (a `ChatTurn`) when a turn starts or changes status, or a Clear is recorded (a ' +
      'turn of kind `clear`); `event: event` with ' +
      '`{turnId, turnSeq, seq, event, at}` for each event, its `id:` `<turnSeq>.<seq>`; `event: removed` with ' +
      '`{turnId}` when a waiting message goes (discarded, or taken into the running turn); `event: decision` with ' +
      '`{decision}` (a `Decision`) when the agent records one; a `: heartbeat` comment every 20 s. Send the last id you saw as `Last-Event-ID` to get the turns from its turn on and the events after it ' +
      'first. Without it, only what happens from now on.',
    request: {
      params: ChatParamsSchema,
      headers: z.object({ 'last-event-id': z.string().optional() }),
    },
    responses: {
      200: { description: 'The stream', content: { 'text/event-stream': { schema: z.string() } } },
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
    },
  });
};

export function streamRoutes(deps: ServerDeps, stream: StreamDeps) {
  return newRouter().openapi(streamRoute(deps), async (c) => {
    const { chatId } = c.req.valid('param');
    const chat = await chatsRepo.get(c.var.tenant, chatId);
    if (chat === undefined) return errorJson(c, 404, CHAT_NOT_FOUND.code, CHAT_NOT_FOUND.message);
    const after = parseChatEventId(c.req.valid('header')['last-event-id']);
    const tenant = c.var.tenant;
    c.header('cache-control', 'no-store');
    return streamSSE(c, async (sse) => {
      const closed = new Promise<void>((resolve) => sse.onAbort(resolve));
      await streamChat(
        stream,
        tenant,
        chat.id,
        after,
        {
          message: (event, data, id) =>
            sse.writeSSE(id === undefined ? { event, data } : { event, data, id }),
          comment: (text) => sse.write(`: ${text}\n\n`).then(() => undefined),
        },
        closed,
      );
    });
  });
}
