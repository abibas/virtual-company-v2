import type { ChatTurn } from '@mwc/db';
import { senderOf, visibleTextOf } from '../../chats/index.ts';
import type { AgentRef, ChatRef, ChatTurnsRow } from '../repo/conversations.ts';
import type { AgentCountView, ConversationView } from '../schemas.ts';

/**
 * A contact's conversations with the company's agents (2026-11-14, docs/subscriptions.md "Contacts"), pure: each chat
 * with its agent, its last message (the agent's reply, else the contact's message as the reader sees it) and whether a
 * turn waits or runs there, the latest first; and per agent how many conversations and messages, the latest first.
 */

/** The longest last message shown, on one line. */
export const LAST_MESSAGE_MAX = 300;
/** The most conversations a contact's page lists. */
export const CONVERSATIONS_MAX = 200;

const oneLine = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= LAST_MESSAGE_MAX ? line : `${line.slice(0, LAST_MESSAGE_MAX - 1).trimEnd()}…`;
};

/** A chat's last message from its latest turn: the agent's reply, else a message from outside; null for neither. */
export function lastMessage(turn: ChatTurn): ConversationView['last'] {
  const reply = turn.status === 'done' ? (turn.resultText ?? '').trim() : '';
  if (reply !== '')
    return { by: 'agent', text: oneLine(reply), at: (turn.endedAt ?? turn.createdAt).toISOString() };
  if (senderOf(turn) === null) return null;
  return { by: 'contact', text: oneLine(visibleTextOf(turn) ?? ''), at: turn.createdAt.toISOString() };
}

/** What a contact's page lists of their conversations, from the reads. */
export interface ConversationReads {
  readonly chats: readonly ChatRef[];
  readonly agents: ReadonlyMap<string, AgentRef>;
  readonly places: ReadonlyMap<string, string>;
  readonly latest: ReadonlyMap<string, ChatTurn>;
  readonly live: ReadonlySet<string>;
}

/** The conversations, the latest first (by the chat's last change), at most `CONVERSATIONS_MAX`. */
export function conversationsOf(reads: ConversationReads): ConversationView[] {
  return [...reads.chats]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id))
    .slice(0, CONVERSATIONS_MAX)
    .flatMap((chat) => {
      const agent = reads.agents.get(chat.agentId);
      if (agent === undefined) return [];
      const latest = reads.latest.get(chat.id);
      return [
        {
          chatId: chat.id,
          title: chat.title,
          place: reads.places.get(chat.id) ?? null,
          agent,
          last: latest === undefined ? null : lastMessage(latest),
          live: reads.live.has(chat.id),
          archived: chat.archivedAt !== null,
          updatedAt: chat.updatedAt.toISOString(),
        },
      ];
    });
}

/** Per agent, the contact's conversations and messages there and the latest, the one talked to last first. */
export function agentCounts(
  rows: readonly ChatTurnsRow[],
  chats: ReadonlyMap<string, ChatRef>,
  agents: ReadonlyMap<string, AgentRef>,
): AgentCountView[] {
  const per = new Map<string, { conversations: number; messages: number; lastAt: Date }>();
  for (const row of rows) {
    const agentId = chats.get(row.chatId)?.agentId;
    if (agentId === undefined) continue;
    const count = per.get(agentId) ?? { conversations: 0, messages: 0, lastAt: row.lastAt };
    count.conversations += 1;
    count.messages += row.messages;
    if (row.lastAt > count.lastAt) count.lastAt = row.lastAt;
    per.set(agentId, count);
  }
  return [...per.entries()]
    .flatMap(([agentId, count]) => {
      const agent = agents.get(agentId);
      return agent === undefined ? [] : [{ agent, ...count }];
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map(({ agent, conversations, messages, lastAt }) => ({
      agent,
      conversations,
      messages,
      lastAt: lastAt.toISOString(),
    }));
}
