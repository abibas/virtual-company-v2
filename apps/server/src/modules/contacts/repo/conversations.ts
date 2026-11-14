import { agents, type ChatTurn, chats, chatTurns, slackThreads, type TenantDb } from '@mwc/db';
import { and, eq, inArray, isNotNull, max, or, type SQL, sql } from 'drizzle-orm';

/**
 * What contacts said and to whom (2026-11-14, docs/subscriptions.md "Contacts"), read only, through the tenant: their
 * turns per chat (`chat_turns.contact_id`), the Slack conversations they started (`slack_threads.contact_id`), those
 * chats, their latest turns and whether a turn waits or runs there, and the agents.
 */

/** A contact's turns in one chat: how many (since a time, when asked), the latest, and whether one waits or runs. */
export interface ChatTurnsRow {
  readonly contactId: string;
  readonly chatId: string;
  readonly messages: number;
  readonly lastAt: Date;
  readonly live: boolean;
}

const LIVE = sql`${chatTurns.status} in ('queued', 'running')`;

/**
 * Per contact and chat, their turns: one contact's or everyone's; with `since`, only the chats where they wrote since
 * then or a turn of theirs still waits or runs, counting the ones since then.
 */
async function turnsByChat(
  t: TenantDb,
  which: { readonly contactId?: string; readonly since?: Date },
): Promise<ChatTurnsRow[]> {
  const since = which.since?.toISOString();
  const recent = since === undefined ? undefined : sql`${chatTurns.createdAt} >= ${since}::timestamptz`;
  const where: (SQL | undefined)[] = [
    which.contactId === undefined ? isNotNull(chatTurns.contactId) : eq(chatTurns.contactId, which.contactId),
    recent === undefined ? undefined : or(recent, LIVE),
  ];
  const rows = await t
    .selectFields(
      chatTurns,
      {
        contactId: chatTurns.contactId,
        chatId: chatTurns.chatId,
        messages:
          recent === undefined
            ? sql<number>`count(*)`.mapWith(Number)
            : sql<number>`count(*) filter (where ${recent})`.mapWith(Number),
        lastAt: max(chatTurns.createdAt),
        live: sql<boolean>`bool_or(${LIVE})`.mapWith(Boolean),
      },
      and(...where),
    )
    .groupBy(chatTurns.contactId, chatTurns.chatId);
  return rows.map((row) => ({ ...row, contactId: row.contactId as string, lastAt: row.lastAt as Date }));
}

/** The Slack conversations a contact started: their chats and where they are. */
const threadsOf = (t: TenantDb, contactId: string) =>
  t.selectFields(
    slackThreads,
    { chatId: slackThreads.chatId, place: slackThreads.place },
    eq(slackThreads.contactId, contactId),
  );

/** Where these chats' Slack conversations are. */
const placesOf = (t: TenantDb, chatIds: readonly string[]) =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        slackThreads,
        { chatId: slackThreads.chatId, place: slackThreads.place },
        inArray(slackThreads.chatId, [...chatIds]),
      );

/** These chats: their agent, title, last change and whether archived. */
const chatsOf = (t: TenantDb, chatIds: readonly string[]) =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        chats,
        {
          id: chats.id,
          agentId: chats.agentId,
          title: chats.title,
          updatedAt: chats.updatedAt,
          archivedAt: chats.archivedAt,
        },
        inArray(chats.id, [...chatIds]),
      );

/** Each of these chats' latest turn (its highest number). */
const latestTurns = (t: TenantDb, chatIds: readonly string[]): Promise<ChatTurn[]> =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t.select(
        chatTurns,
        and(
          inArray(chatTurns.chatId, [...chatIds]),
          sql`${chatTurns.seq} = (select max(l.seq) from chat_turns l where l.company_id = ${chatTurns.companyId} and l.chat_id = ${chatTurns.chatId})`,
        ),
      );

/** Those of these chats where a turn waits or runs now. */
async function liveChats(t: TenantDb, chatIds: readonly string[]): Promise<Set<string>> {
  if (chatIds.length === 0) return new Set();
  const rows = await t
    .selectFields(chatTurns, { chatId: chatTurns.chatId }, and(inArray(chatTurns.chatId, [...chatIds]), LIVE))
    .groupBy(chatTurns.chatId);
  return new Set(rows.map((row) => row.chatId));
}

/** These agents, by their ids. */
const agentsOf = (t: TenantDb, agentIds: readonly string[]) =>
  agentIds.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        agents,
        { id: agents.id, principalId: agents.principalId, name: agents.name, slug: agents.slug },
        inArray(agents.id, [...agentIds]),
      );

export const conversationsRepo = {
  turnsByChat,
  threadsOf,
  placesOf,
  chatsOf,
  latestTurns,
  liveChats,
  agentsOf,
};

export type ChatRef = Awaited<ReturnType<typeof chatsOf>>[number];
export type AgentRef = Awaited<ReturnType<typeof agentsOf>>[number];
