import { createRoute } from '@hono/zod-openapi';
import { TERMINAL_WS_PATH } from '@mwc/shared/runner-protocol';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { TerminalTicketSchema } from '../../machines/index.ts';
import { ChatParamsSchema } from '../schemas.ts';
import { type ChatTerminalDeps, chatTerminalTicket } from '../service/terminal.ts';
import { TURN_REFUSALS } from './turns.ts';

/**
 * A chat's terminal (S5.1b): `POST /api/companies/{companyId}/chats/{chatId}/terminal-tickets` (owners only, as the
 * machine terminal) gives the machine terminal's one-time ticket; its socket (`/api/terminal/ws`) opens the harness's
 * own TUI on the chat's conversation in the agent's folder, with the credential resolved here.
 */

const TICKETS = '/api/companies/{companyId}/chats/{chatId}/terminal-tickets' as const;

const ticketRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'owner', path: TICKETS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "A one-time ticket for a chat's terminal: the harness's TUI on its conversation (owners only)",
    description:
      "The ticket opens the browser socket at `wsPath` once, within 60 s. The TUI runs as the machine's runner user, " +
      "in the agent's folder, on the chat's access profile (else the agent's). Typing there spends that subscription.",
    request: { params: ChatParamsSchema },
    responses: {
      201: jsonResponse('The ticket, shown once', TerminalTicketSchema),
      ...refusals,
      403: errorResponse('The caller is not an owner (`forbidden`)'),
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: errorResponse(`${TURN_REFUSALS[409]}; or the runner has no terminal (\`terminal_unavailable\`)`),
      422: errorResponse(TURN_REFUSALS[422]),
      503: errorResponse(TURN_REFUSALS[503]),
    },
  });
};

export function chatTerminalRoutes(deps: ServerDeps & ChatTerminalDeps) {
  return newRouter().openapi(ticketRoute(deps), async (c) => {
    const { chatId } = c.req.valid('param');
    const { userId, principalId } = c.var.membership;
    const result = await chatTerminalTicket(
      deps,
      c.var.tenant,
      { userId, principalId },
      chatId,
      c.var.clock(),
    );
    if (!result.ok) return errorJson(c, result.status as 404 | 409 | 422 | 503, result.code, result.message);
    c.header('cache-control', 'no-store');
    const { ticket, expiresAt } = result.ticket;
    return c.json({ ticket, expiresAt: expiresAt.toISOString(), wsPath: TERMINAL_WS_PATH } as const, 201);
  });
}
