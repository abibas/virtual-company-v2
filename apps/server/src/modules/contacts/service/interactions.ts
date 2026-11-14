import type { TenantDb } from '@mwc/db';
import { conversationsRepo as convs } from '../repo/conversations.ts';
import { contactsRepo as repo } from '../repo.ts';
import { interactionsOf } from '../rules/interactions.ts';
import { windowStart } from '../rules.ts';
import type { InteractionsView } from '../schemas.ts';

/**
 * Who talked to which agent lately (2026-11-14, docs/subscriptions.md "Contacts"), for the org chart's Requesters:
 * per contact that is not archived, the agents their messages woke since `since` (7 days ago by default, at most 90),
 * with how many and the latest, and whether a turn of theirs waits or runs now. Five reads.
 */
export async function contactInteractions(
  t: TenantDb,
  since: string | undefined,
  now: Date,
): Promise<InteractionsView> {
  const start = windowStart(since, now);
  const rows = await convs.turnsByChat(t, { since: start });
  const chats = await convs.chatsOf(t, [...new Set(rows.map((row) => row.chatId))]);
  const agents = await convs.agentsOf(t, [...new Set(chats.map((chat) => chat.agentId))]);
  const contacts = await repo.byIds(t, [...new Set(rows.map((row) => row.contactId))]);
  const contactsView = interactionsOf(rows, {
    chats: new Map(chats.map((chat) => [chat.id, chat])),
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    contacts: new Map(contacts.map((contact) => [contact.id, contact])),
  });
  return { since: start.toISOString(), contacts: contactsView };
}
