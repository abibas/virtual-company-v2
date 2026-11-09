import { createRoute } from '@hono/zod-openapi';
import { TERMINAL_WS_PATH } from '@mwc/shared/runner-protocol';
import type { MiddlewareHandler } from 'hono';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { AppEnv, ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { upgradeSocket } from '../../../platform/realtime/sockets.ts';
import { TerminalSocketQuery, TerminalTicketSchema } from '../schemas/terminal.ts';
import { MachineParamsSchema } from '../schemas.ts';
import type { RunnerHub } from '../service/runner/hub.ts';
import { type TerminalTickets, terminalTickets } from '../service/terminal/tickets.ts';
import { type OpenTerminal, type TerminalService, terminalService } from '../service/terminal.ts';

/**
 * A machine's terminal (docs/machines.md, "Terminal"): an owner's one-time ticket
 * (`POST /api/companies/{companyId}/machines/{machineId}/terminal-tickets`, owners only), then the browser's WebSocket
 * `GET /api/terminal/ws?ticket=…&cols=…&rows=…`, refused before the upgrade unless it is an upgrade (426), from the web
 * origin (`MWC_WEB_ORIGIN`, 403), with a size (400) and a good ticket (401). The socket is not in the OpenAPI document.
 */

/** The browser socket's route: the redeemed ticket and the first size on `c.var.terminal`. */
interface TerminalEnv extends AppEnv {
  Variables: AppEnv['Variables'] & {
    terminal: OpenTerminal & { readonly cols: number; readonly rows: number };
  };
}

const ticketRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'owner',
    path: '/api/companies/{companyId}/machines/{machineId}/terminal-tickets' as const,
    tag: 'machines',
  });
  return createRoute({
    ...base,
    method: 'post',
    summary: "A one-time ticket for a machine's terminal (owners only)",
    description:
      'The ticket opens the browser socket at `wsPath` once, within 60 s, as you, on this machine only. The shell runs ' +
      "as the machine's runner user, with that user's rights there. Each terminal opened is in the audit log.",
    request: { params: MachineParamsSchema },
    responses: {
      201: jsonResponse('The ticket, shown once', TerminalTicketSchema),
      ...refusals,
      403: errorResponse('The caller is not an owner (`forbidden`)'),
      404: errorResponse(
        'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
      ),
      409: errorResponse(
        "The machine's runner is not connected (`machine_offline`), or has no terminal (`terminal_unavailable`)",
      ),
    },
  });
};

/** A plain request is no terminal. */
const wantsUpgrade: MiddlewareHandler<TerminalEnv> = async (c, next) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return errorJson(c, 426, 'upgrade_required', 'The terminal is a WebSocket');
  }
  await next();
};

/** Only the web app's own pages open a terminal (a browser always sends its page's Origin with a WebSocket). */
const fromWebOrigin =
  (origin: string): MiddlewareHandler<TerminalEnv> =>
  async (c, next) => {
    if (c.req.header('origin') !== origin) {
      return errorJson(c, 403, 'origin_not_allowed', `A terminal opens from ${origin} only`);
    }
    await next();
  };

/** The size, then the ticket, used up (and the terminal audited) only once the request is otherwise good. */
const redeemTicket =
  (service: TerminalService): MiddlewareHandler<TerminalEnv> =>
  async (c, next) => {
    const query = TerminalSocketQuery.safeParse(c.req.query());
    if (!query.success) {
      return errorJson(c, 400, 'invalid_request', 'Give ticket, cols (2–500) and rows (1–300)');
    }
    const { ticket, cols, rows } = query.data;
    const open = await service.redeem(ticket, c.var.clock(), c.var.requestId);
    if (open === undefined) {
      return errorJson(c, 401, 'invalid_ticket', 'The ticket is not valid, was used already, or expired');
    }
    c.set('terminal', { ...open, cols, rows });
    await next();
  };

/** The routes, on the app's ticket store (`tickets`, shared with the chats' terminals) or one of their own. */
export function terminalRoutes(
  deps: ServerDeps & { readonly hub: RunnerHub; readonly tickets?: TerminalTickets | undefined },
) {
  const tickets = deps.tickets ?? terminalTickets();
  const service = terminalService({ db: deps.db, hub: deps.hub, tickets });
  return newRouter()
    .openapi(ticketRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const { userId, principalId } = c.var.membership;
      const result = await service.ticket(c.var.tenant, { userId, principalId }, machineId, c.var.clock());
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      c.header('cache-control', 'no-store');
      const { ticket, expiresAt } = result.ticket;
      return c.json({ ticket, expiresAt: expiresAt.toISOString(), wsPath: TERMINAL_WS_PATH } as const, 201);
    })
    .get(
      TERMINAL_WS_PATH,
      wantsUpgrade,
      fromWebOrigin(deps.config.MWC_WEB_ORIGIN),
      redeemTicket(service),
      upgradeSocket<TerminalEnv>((c, link) => service.relay(link, c.var.terminal), {
        pingMs: deps.hub.pingMs,
      }),
    );
}
