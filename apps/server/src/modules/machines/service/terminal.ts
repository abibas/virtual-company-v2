import { type DbHandle, diffFields, type TenantDb, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import type { SocketHandlers, SocketLink } from '../../../platform/realtime/sockets.ts';
import { machinesRepo } from '../repo.ts';
import { MACHINE_NOT_FOUND, MACHINE_OFFLINE, type Refusal, TERMINAL_UNAVAILABLE } from '../rules.ts';
import type { RunnerHub } from './hub.ts';
import { openRelay, type RelayTarget } from './terminal/relay.ts';
import type { IssuedTicket, TerminalTickets, TicketBinding } from './terminal/tickets.ts';

/**
 * A machine's terminal (docs/machines.md, "Terminal"): an owner gets a one-time ticket for an online machine whose
 * runner has a terminal (`ticket`), the browser's socket uses it up and the terminal is audited before it opens
 * (`redeem`), then the socket is relayed to the runner (`relay`, `terminal/relay.ts`). Owners only: the route says so.
 */

const repo = machinesRepo();

/** Who asks for a ticket: the owner's user and principal. */
export interface TerminalCaller {
  readonly userId: string;
  readonly principalId: string;
}

/** A redeemed ticket: whom it was for and the terminal's new session. */
export interface OpenTerminal extends TicketBinding {
  readonly sessionId: string;
}

export interface TerminalDeps {
  readonly db: DbHandle;
  readonly hub: RunnerHub;
  readonly tickets: TerminalTickets;
}

export function terminalService(deps: TerminalDeps) {
  return {
    /** A ticket for the company's machine: 404 for no such machine, 409 when it is offline or has no terminal. */
    async ticket(
      t: TenantDb,
      caller: TerminalCaller,
      machineId: string,
      now: Date,
    ): Promise<{ readonly ok: true; readonly ticket: IssuedTicket } | Refusal<404> | Refusal<409>> {
      if ((await repo.get(t, machineId)) === undefined) return MACHINE_NOT_FOUND;
      const runner = deps.hub.connected(machineId);
      if (runner === undefined) return MACHINE_OFFLINE;
      if (!runner.caps.terminal) return TERMINAL_UNAVAILABLE;
      const binding = { ...caller, companyId: t.companyId, machineId };
      return { ok: true, ticket: deps.tickets.issue(binding, now) };
    },

    /**
     * Uses up a ticket and records the terminal it opens in the audit log (who, which machine, the session), before
     * anything opens; undefined for an unknown, used or expired ticket.
     */
    async redeem(ticket: string, now: Date, requestId: string): Promise<OpenTerminal | undefined> {
      const binding = deps.tickets.redeem(ticket, now);
      if (binding === undefined) return undefined;
      const sessionId = newId();
      const t = await tenant(deps.db, binding.companyId);
      await repo.audit(t, {
        actorKind: 'user',
        actorPrincipalId: binding.principalId,
        requestId,
        entityType: 'machine',
        entityId: binding.machineId,
        action: 'terminal_open',
        changes: diffFields(null, { terminalSession: sessionId }),
      });
      return { ...binding, sessionId };
    },

    /** The browser's socket, now open: the terminal opens on the runner and the two are relayed. */
    relay(link: SocketLink, target: RelayTarget): SocketHandlers {
      return openRelay(deps.hub, link, target);
    },
  };
}

export type TerminalService = ReturnType<typeof terminalService>;
