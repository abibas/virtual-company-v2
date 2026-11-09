import { z } from '@hono/zod-openapi';
import { TERMINAL_COLS, TERMINAL_ROWS, TERMINAL_WS_PATH } from '@mwc/shared/runner-protocol';

/**
 * The terminal's shapes (docs/machines.md, "Terminal"): the one-time ticket an owner gets
 * (`POST /api/companies/{companyId}/machines/{machineId}/terminal-tickets`) and the query of the browser's socket.
 */

export const TerminalTicketSchema = z
  .object({
    ticket: z
      .string()
      .openapi({ description: 'Opens the socket once, within 60 s; shown in this response only' }),
    expiresAt: z.string().openapi({ format: 'date-time' }),
    wsPath: z.literal(TERMINAL_WS_PATH).openapi({
      description: 'Where the browser opens the socket: `<wsPath>?ticket=…&cols=…&rows=…` on this server',
    }),
  })
  .openapi('TerminalTicket');
export type TerminalTicketView = z.infer<typeof TerminalTicketSchema>;

/** `?ticket=…&cols=…&rows=…`: the ticket and the terminal's first size. */
export const TerminalSocketQuery = z.object({
  ticket: z.string().min(1).max(256),
  cols: z.coerce.number().int().min(TERMINAL_COLS.min).max(TERMINAL_COLS.max),
  rows: z.coerce.number().int().min(TERMINAL_ROWS.min).max(TERMINAL_ROWS.max),
});
