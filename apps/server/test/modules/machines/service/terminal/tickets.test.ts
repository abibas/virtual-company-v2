import { createHash } from 'node:crypto';
import { newId } from '@mwc/shared/ids';
import { TERMINAL_TICKET_TTL_MS } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { terminalTickets } from '../../../../../src/modules/machines/service/terminal/tickets.ts';

const binding = { userId: newId(), principalId: newId(), companyId: newId(), machineId: newId() };
const at = (ms: number) => new Date(Date.UTC(2026, 10, 9, 12) + ms);

describe('terminal tickets', () => {
  it('are random, kept as their SHA-256 only, and good once', () => {
    const tickets = terminalTickets();
    const issued = tickets.issue(binding, at(0));
    const other = tickets.issue(binding, at(0));
    expect(issued.ticket).not.toBe(other.ticket);
    expect(issued.expiresAt).toEqual(at(TERMINAL_TICKET_TTL_MS));
    const hash = createHash('sha256').update(issued.ticket).digest('hex');
    expect(tickets.hashes()).toContain(hash);
    expect(tickets.hashes().join()).not.toContain(issued.ticket);
    expect(tickets.redeem(issued.ticket, at(1000))).toEqual(binding);
    expect(tickets.redeem(issued.ticket, at(1000))).toBeUndefined();
    expect(tickets.redeem('mwc_tt_unknown', at(1000))).toBeUndefined();
  });

  it('expire after 60 s, and expired ones are swept', () => {
    const tickets = terminalTickets();
    const late = tickets.issue(binding, at(0));
    const swept = tickets.issue(binding, at(0));
    expect(tickets.redeem(late.ticket, at(TERMINAL_TICKET_TTL_MS))).toBeUndefined();
    expect(tickets.hashes()).toHaveLength(0);
    tickets.issue(binding, at(TERMINAL_TICKET_TTL_MS + 1));
    expect(tickets.hashes()).toHaveLength(1);
    expect(tickets.redeem(swept.ticket, at(1))).toBeUndefined();
    const short = terminalTickets(10);
    const quick = short.issue(binding, at(0));
    expect(short.redeem(quick.ticket, at(9))).toEqual(binding);
  });
});
