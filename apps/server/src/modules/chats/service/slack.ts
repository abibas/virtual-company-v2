import type { TenantDb } from '@mwc/db';
import { chatsRepo } from '../repo.ts';
import { CHAT_ARCHIVED, CHAT_NOT_FOUND, type Refusal, refuse } from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import { type NoteDeps, recordNote } from './notes.ts';
import { turnView } from './views.ts';

/**
 * Send in Slack (2026-11-14, docs/subscriptions.md "Send in Slack"): in a Slack conversation's chat, its Slack
 * connection's owner posts a message straight into that conversation (the DM or the thread) through the bot, as the bot,
 * with no agent turn. The chats module defines the port and keeps the message as a turn of kind `slack` (its address in
 * Slack as the turn's `replyLink`); the integrations module implements it (`ChatSlackHook`, passed in by `app.ts`): it
 * checks the owner, the profile's Slack post rights and the conversation, posts, records the post in `slack_posts` (a
 * reply to it comes back to this chat) and audits it. A refusal says why in words.
 */

/** The Slack conversation a chat is for, as its reader sees it. */
export interface SlackConversationView {
  /** Where it is, in words (`#general`, `a DM with Erich`). */
  readonly place: string;
  /** The conversation in Slack, when the workspace's address is known. */
  readonly link: string | null;
  /** The reader is the Slack connection's owner. */
  readonly mayPost: boolean;
}

/** What a post asks: the chat, its agent, who sends (their person and principal), the text and the request. */
export interface SlackPostRequest {
  readonly chatId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly principalId: string;
  readonly text: string;
  readonly requestId: string;
}

/** Where the post went (its message's address), or why it did not. */
export type SlackPosted =
  | { readonly ok: true; readonly link: string | null }
  | {
      readonly ok: false;
      readonly status: 403 | 409 | 422 | 503;
      readonly code: string;
      readonly message: string;
    };

/** The port the integrations module implements. */
export interface ChatSlackHook {
  /** The chat's Slack conversation as `userId` sees it; null for any other chat. */
  conversationOf(t: TenantDb, chatId: string, userId: string): Promise<SlackConversationView | null>;
  /** Posts the text in the chat's Slack conversation (see above). */
  post(t: TenantDb, request: SlackPostRequest): Promise<SlackPosted>;
}

export const SLACK_UNAVAILABLE = refuse(
  409,
  'not_slack_chat',
  'This chat is not for a Slack conversation: there is nowhere to send in Slack',
);

export interface SlackSendDeps extends NoteDeps {
  readonly slack?: ChatSlackHook | undefined;
}

/** Sends the text in the chat's Slack conversation (see above); the `slack` turn that keeps it, or why not. */
export async function sendInSlack(
  deps: SlackSendDeps,
  t: TenantDb,
  sender: Omit<SlackPostRequest, 'chatId' | 'agentId' | 'text'>,
  chatId: string,
  text: string,
): Promise<{ readonly ok: true; readonly turn: ChatTurnView } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  if (deps.slack === undefined) return SLACK_UNAVAILABLE;
  const posted = await deps.slack.post(t, { ...sender, chatId: chat.id, agentId: chat.agentId, text });
  if (!posted.ok) return posted;
  const note = { kind: 'slack' as const, prompt: text, by: sender.principalId, replyLink: posted.link };
  return { ok: true, turn: turnView(await recordNote(deps, t, chat.id, note)) };
}
