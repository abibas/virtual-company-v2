import { owned, type TenantDb } from '@mwc/db';
import { slackAllows } from '@mwc/shared/credentials';
import { isSlackError, type SlackInboundMessage, type SlackMessage } from '@mwc/tools-core';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { isThreadReply } from '../../../rules/slack/inbound/event.ts';
import { mentionedIds } from '../../../rules/slack/inbound/text.ts';
import {
  historyScopes,
  missingScopeLine,
  type Seen,
  threadBlock,
  threadLine,
  unreadLine,
  unseenMessages,
} from '../../../rules/slack/inbound/thread.ts';
import type { Connection, HandleDeps } from './context.ts';

/**
 * A reply's thread context (2026-11-14, docs/subscriptions.md "Thread context"): for a message that is a reply in a
 * thread, the thread's earlier messages the agent has not seen (`rules/slack/inbound/thread.ts`), read with
 * `conversations.replies` through the connection's bot, named with `users.info` (with `users:read`), as a block for the
 * prompt; or one line when the bot lacks the history scope or Slack refuses. "Seen" is the chat's last successful
 * turn's (the chats module's `lastAnsweredAt`) and the agent's own posts there. Nothing is recorded or posted.
 */

/** The most pages (of `PAGE` messages) of a thread read. */
const PAGES = 5;
const PAGE = 200;
/** The most people looked up for a thread's names, besides the message's own. */
export const THREAD_NAMES_MAX = 15;

/** The thread's messages, its first one first (up to `PAGES` pages). */
async function threadMessages(deps: HandleDeps, conn: Connection, channel: string, root: string) {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const read = await deps.slack.replies(conn.signIn, channel, root, { limit: PAGE, cursor });
    messages.push(...read.items);
    if (read.nextCursor === null) break;
    cursor = read.nextCursor;
  }
  return messages;
}

/** What the agent has seen there (see above): nothing without a chat. */
async function seenIn(
  deps: HandleDeps,
  conn: Connection,
  t: TenantDb,
  at: { readonly channel: string; readonly chatId: string | null },
): Promise<Seen> {
  if (at.chatId === null) return { seenUntil: null, own: new Set() };
  const answered = await deps.chats.lastAnsweredAt(t, at.chatId);
  const where = { credentialId: conn.credentialId, channelId: at.channel, chatId: at.chatId };
  const own = await repo.ownPostsOfChat(owned(deps.db, conn.ownerUserId), where);
  return { seenUntil: answered === null ? null : answered.getTime() / 1000, own };
}

/** Adds the names of the messages' authors and mentions not named yet (with `users:read`, a few at most). */
async function nameAll(
  deps: HandleDeps,
  conn: Connection,
  messages: SlackMessage[],
  names: Map<string, string>,
) {
  if (!slackAllows('users', 'slack_bot_token', conn.bot.scopes)) return;
  const ids = messages.flatMap((message) => [
    ...(message.user === null ? [] : [message.user]),
    ...mentionedIds(message.text),
  ]);
  const unnamed = [...new Set(ids)].filter((id) => !names.has(id)).slice(0, THREAD_NAMES_MAX);
  for (const id of unnamed) {
    try {
      const user = await deps.slack.userInfo(conn.signIn, id);
      names.set(id, user.realName ?? user.displayName ?? user.name);
    } catch (error) {
      if (!isSlackError(error)) throw error;
    }
  }
}

/** The block for the prompt, one line instead, or null (not a reply, nothing unseen). */
export async function threadContext(
  deps: HandleDeps,
  conn: Connection,
  t: TenantDb,
  at: {
    readonly message: SlackInboundMessage;
    readonly chatId: string | null;
    readonly names: Map<string, string>;
  },
): Promise<string | null> {
  const { message } = at;
  if (!isThreadReply(message)) return null;
  const scopes = historyScopes(message);
  if (!scopes.some((scope) => conn.bot.scopes.includes(scope))) return missingScopeLine(scopes);
  const root = message.threadTs as string;
  let messages: SlackMessage[];
  try {
    messages = await threadMessages(deps, conn, message.channel, root);
  } catch (error) {
    if (!isSlackError(error)) throw error;
    deps.logger.warn(
      { credentialId: conn.credentialId, code: error.code },
      'slack inbound: no thread context',
    );
    return error.slackError === 'missing_scope' ? missingScopeLine(scopes) : unreadLine(error.message);
  }
  const seen = await seenIn(deps, conn, t, { channel: message.channel, chatId: at.chatId });
  const unseen = unseenMessages(messages, { root, ts: message.ts }, seen);
  await nameAll(deps, conn, unseen, at.names);
  const lines = unseen.map((one) => threadLine(one, at.names, root));
  return threadBlock(lines, unseen[0]?.ts === root);
}
