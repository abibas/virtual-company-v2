import type { TenantDb } from '@mwc/db';
import { type ChatTurnsRow, conversationsRepo as convs } from '../repo/conversations.ts';
import { contactsRepo as repo } from '../repo.ts';
import { agentCounts, conversationsOf } from '../rules/conversations.ts';
import { contactView } from '../rules.ts';
import type { ContactDetailView, ContactListItemView } from '../schemas.ts';
import { CONTACT_NOT_FOUND } from './update.ts';

/**
 * Reading contacts (2026-11-14, docs/subscriptions.md "Contacts"), members and above: the list (the latest seen first,
 * each with the agents they talked to and how many conversations) and a contact's page (their conversations with the
 * company's agents, the latest first, and the counts per agent). A fixed number of reads, whatever the count.
 */

const byId = <T extends { readonly id: string }>(rows: readonly T[]) =>
  new Map(rows.map((row) => [row.id, row]));

/** The chats of these turns, with the agents they are with. */
async function chatsAndAgents(t: TenantDb, chatIds: readonly string[]) {
  const chats = await convs.chatsOf(t, chatIds);
  const agents = await convs.agentsOf(t, [...new Set(chats.map((chat) => chat.agentId))]);
  return { chats, agents: byId(agents) };
}

/** The company's contacts (archived ones too with `archived`), the latest seen first. */
export async function listContacts(t: TenantDb, archived: boolean): Promise<ContactListItemView[]> {
  const rows = await repo.list(t, archived);
  const turns = await convs.turnsByChat(t, {});
  const chats = byId((await chatsAndAgents(t, [...new Set(turns.map((row) => row.chatId))])).chats);
  const per = new Map<string, ChatTurnsRow[]>();
  for (const row of turns) per.set(row.contactId, [...(per.get(row.contactId) ?? []), row]);
  return rows.map((row) => {
    const own = [...(per.get(row.id) ?? [])].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
    const agentIds = own.flatMap((turn) => {
      const agentId = chats.get(turn.chatId)?.agentId;
      return agentId === undefined ? [] : [agentId];
    });
    return { ...contactView(row), agentIds: [...new Set(agentIds)], conversations: own.length };
  });
}

/** A contact's page (see above), or 404. */
export async function contactDetail(
  t: TenantDb,
  contactId: string,
): Promise<{ readonly ok: true; readonly detail: ContactDetailView } | typeof CONTACT_NOT_FOUND> {
  const row = await repo.get(t, contactId);
  if (row === undefined) return CONTACT_NOT_FOUND;
  const turns = await convs.turnsByChat(t, { contactId: row.id });
  const started = await convs.threadsOf(t, row.id);
  const chatIds = [
    ...new Set([...turns.map((turn) => turn.chatId), ...started.map((thread) => thread.chatId)]),
  ];
  const { chats, agents } = await chatsAndAgents(t, chatIds);
  const places = await convs.placesOf(t, chatIds);
  const latest = await convs.latestTurns(t, chatIds);
  const live = await convs.liveChats(t, chatIds);
  const conversations = conversationsOf({
    chats,
    agents,
    places: new Map(places.map((place) => [place.chatId, place.place])),
    latest: new Map(latest.map((turn) => [turn.chatId, turn])),
    live,
  });
  const counts = agentCounts(turns, byId(chats), agents);
  return { ok: true, detail: { contact: contactView(row), conversations, agents: counts } };
}
