import { owned, type SlackThread, type TenantDb } from '@mwc/db';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import type { Connection, InboundDeps } from './context.ts';

/**
 * The agent's chat for a Slack conversation (2026-11-14, docs/subscriptions.md "One conversation per thread"): the one
 * recorded for that thread (`slack_threads`), else the Slack chat of the agent's latest post in that thread (its answer
 * to a message that pointed to another thread went there, and so did its answers in a DM's conversation from before,
 * when the DM itself was one), else none: a new chat.
 */

/** The thread's chat, and whether the thread has a row of its own (kept up to date after the turn). */
export interface Conversation {
  readonly chatId: string | null;
  readonly recorded: boolean;
}

export type ConversationKey = Pick<SlackThread, 'agentId' | 'credentialId' | 'channelId' | 'threadTs'>;

const NEW: Conversation = { chatId: null, recorded: false };

/** The conversation's chat (see above). */
export async function conversationOf(
  deps: InboundDeps,
  conn: Connection,
  t: TenantDb,
  key: ConversationKey,
): Promise<Conversation> {
  const row = await repo.threadOf(t, key);
  if (row !== undefined) return { chatId: row.chatId, recorded: true };
  if (key.threadTs === null) return NEW;
  const o = owned(deps.db, conn.ownerUserId);
  const at = { credentialId: key.credentialId, channelId: key.channelId, companyId: t.companyId };
  const chatId = await repo.threadPostChat(o, { ...at, agentId: key.agentId, root: key.threadTs });
  const chat = chatId === undefined ? undefined : await repo.threadOfChat(t, chatId);
  const same = chat !== undefined && chat.agentId === key.agentId && chat.credentialId === key.credentialId;
  return same ? { chatId: chat.chatId, recorded: false } : NEW;
}

/** True when the turn's chat needs the thread's row written: the thread has one, or the chat is new to it. */
export const savesThread = (found: Conversation, chatId: string) => found.recorded || found.chatId !== chatId;
