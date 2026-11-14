import type { Contact } from '@mwc/db';
import type { AgentRef, ChatRef, ChatTurnsRow } from '../repo/conversations.ts';
import type { InteractionsView } from '../schemas.ts';

/**
 * Who talked to which agent lately (2026-11-14, docs/subscriptions.md "Contacts", the org chart's Requesters), pure:
 * per contact that is not archived, each agent they woke since the window's start (how many messages, the latest) or
 * whose turn of theirs waits or runs now; the contact live when any is. The latest first, contacts and agents both.
 */

interface AgentTally {
  readonly agent: AgentRef;
  messages: number;
  lastAt: Date;
  live: boolean;
}

/** The interactions from the contacts' turns per chat (see above). */
export function interactionsOf(
  rows: readonly ChatTurnsRow[],
  reads: {
    readonly chats: ReadonlyMap<string, ChatRef>;
    readonly agents: ReadonlyMap<string, AgentRef>;
    readonly contacts: ReadonlyMap<string, Contact>;
  },
): InteractionsView['contacts'] {
  const per = new Map<string, Map<string, AgentTally>>();
  for (const row of rows) {
    const chat = reads.chats.get(row.chatId);
    const agent = chat === undefined ? undefined : reads.agents.get(chat.agentId);
    const contact = reads.contacts.get(row.contactId);
    if (agent === undefined || contact === undefined || contact.archivedAt !== null) continue;
    const tallies = per.get(row.contactId) ?? new Map<string, AgentTally>();
    const tally = tallies.get(agent.id) ?? { agent, messages: 0, lastAt: row.lastAt, live: false };
    tally.messages += row.messages;
    if (row.lastAt > tally.lastAt) tally.lastAt = row.lastAt;
    tally.live ||= row.live;
    tallies.set(agent.id, tally);
    per.set(row.contactId, tallies);
  }
  const latest = (tallies: readonly AgentTally[]) => Math.max(...tallies.map((t) => t.lastAt.getTime()));
  return [...per.entries()]
    .map(([contactId, tallies]) => ({
      contact: reads.contacts.get(contactId) as Contact,
      tallies: [...tallies.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()),
    }))
    .sort((a, b) => latest(b.tallies) - latest(a.tallies))
    .map(({ contact, tallies }) => ({
      contact: { id: contact.id, name: contact.name, avatarUrl: contact.avatarUrl, title: contact.title },
      live: tallies.some((tally) => tally.live),
      agents: tallies.map((tally) => ({
        agentId: tally.agent.id,
        principalId: tally.agent.principalId,
        messages: tally.messages,
        lastAt: tally.lastAt.toISOString(),
        live: tally.live,
      })),
    }));
}
