import { createHash, randomBytes } from 'node:crypto';
import { TERMINAL_TICKET_TTL_MS } from '@mwc/shared/runner-protocol';

/**
 * Terminal tickets (docs/machines.md, "Terminal"): a browser cannot send an `Authorization` header with a WebSocket, so
 * an owner first gets a ticket over the API and opens the terminal's socket with it in the address. A ticket is random
 * (`mwc_tt_` and 43 base64url characters), works once within 60 s, is bound to the user, the company and the machine,
 * and is kept in this process's memory as its SHA-256 only. Expired ones are swept at each issue and redeem.
 */

/** Whom and what a ticket opens a terminal for. */
export interface TicketBinding {
  readonly userId: string;
  readonly principalId: string;
  readonly companyId: string;
  readonly machineId: string;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly expiresAt: Date;
}

const hashOf = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

export function terminalTickets(ttlMs = TERMINAL_TICKET_TTL_MS) {
  const tickets = new Map<string, { readonly binding: TicketBinding; readonly expiresAt: number }>();
  const sweep = (now: number) => {
    for (const [hash, kept] of tickets) if (kept.expiresAt <= now) tickets.delete(hash);
  };
  return {
    /** A new ticket for `binding`, good once until `now` plus 60 s. */
    issue(binding: TicketBinding, now: Date): IssuedTicket {
      sweep(now.getTime());
      const ticket = `mwc_tt_${randomBytes(32).toString('base64url')}`;
      const expiresAt = now.getTime() + ttlMs;
      tickets.set(hashOf(ticket), { binding, expiresAt });
      return { ticket, expiresAt: new Date(expiresAt) };
    },
    /** Uses a ticket up: its binding, or undefined for an unknown, used or expired one. */
    redeem(ticket: string, now: Date): TicketBinding | undefined {
      const hash = hashOf(ticket);
      const kept = tickets.get(hash);
      tickets.delete(hash);
      sweep(now.getTime());
      return kept !== undefined && kept.expiresAt > now.getTime() ? kept.binding : undefined;
    },
    /** The hashes kept now (tests: never a ticket itself). */
    hashes(): string[] {
      return [...tickets.keys()];
    },
  };
}

export type TerminalTickets = ReturnType<typeof terminalTickets>;
