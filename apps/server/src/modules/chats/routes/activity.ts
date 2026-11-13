import { createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatActivityParamsSchema } from '../schemas/activity.ts';
import { type ActivityDeps, streamActivity } from '../service/activity.ts';

/**
 * The company's chats, live (2026-11-13): `GET /api/companies/{companyId}/chat-activity`, Server-Sent Events over a
 * normal authenticated GET, as a chat's own stream. Members and above: whoever reads an agent's chats hears them.
 */

const ACTIVITY = '/api/companies/{companyId}/chat-activity' as const;

const activityRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: ACTIVITY, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "The company's chats with its agents, live, as Server-Sent Events (member and above)",
    description:
      '`event: chat` with `{chat, lastTurn}` (a `ChatActivity`: the chat as it is now, its latest turn or null) each ' +
      'time a chat is begun, renamed or archived (`archivedAt` set), or one of its turns is queued, starts, changes ' +
      "status or goes, or the agent asks a question, whoever made the turn (a person, a Slack message, a Lead's " +
      "wake-up, the team room). Tasks' conversations are left out. A `: heartbeat` comment every 20 s; nothing is " +
      'replayed: read the lists again after a reconnect.',
    request: { params: ChatActivityParamsSchema },
    responses: {
      200: { description: 'The stream', content: { 'text/event-stream': { schema: z.string() } } },
      ...refusals,
      404: errorResponse('No such company or not an active member (`not_found`)'),
    },
  });
};

export function activityRoutes(deps: ServerDeps, activity: ActivityDeps) {
  return newRouter().openapi(activityRoute(deps), async (c) => {
    const tenant = c.var.tenant;
    c.header('cache-control', 'no-store');
    return streamSSE(c, async (sse) => {
      const closed = new Promise<void>((resolve) => sse.onAbort(resolve));
      await streamActivity(
        activity,
        tenant,
        {
          message: (event, data) => sse.writeSSE({ event, data }),
          comment: (text) => sse.write(`: ${text}\n\n`).then(() => undefined),
        },
        closed,
      );
    });
  });
}
