import { type SlackPerson, slackAllows, storedPeople } from '@mwc/shared/credentials';
import { isSlackError, type SlackInboundMessage } from '@mwc/tools-core';
import { mentionedIds } from '../../../rules/slack/inbound/text.ts';
import type { Place } from '../../../rules/slack/inbound/words.ts';
import { type Connection, type InboundDeps, postIn } from './context.ts';

/**
 * What receiving a Slack message reads of Slack and says back (2026-11-13): where the message is, who wrote it and the
 * names its mentions stand for (with `users:read`), the 👀 reaction before a turn (with `reactions:write`), and a short
 * notice in the message's thread, each kind at most once an hour. Slack's refusals are logged, never thrown: a notice
 * or a name is not worth failing a message for.
 */

export const NOTICE_EVERY_MS = 60 * 60_000;
/** The most people one message's names are looked up for. */
export const NAMES_MAX = 10;

/**
 * Logs Slack's refusal; anything else is thrown. A refused token is not marked here: the connection may still hold the
 * token a renewal just replaced (it opens the new one at its next sync); the daily check and the tools mark it.
 */
async function slackFailed(deps: InboundDeps, conn: Connection, error: unknown, what: string) {
  if (!isSlackError(error)) throw error;
  deps.logger.warn({ credentialId: conn.credentialId, code: error.code, slackError: error.slackError }, what);
}

/** Where the message is: a DM by its id, else the conversation Slack describes (its name; a group DM). */
export async function placeOf(
  deps: InboundDeps,
  conn: Connection,
  message: SlackInboundMessage,
): Promise<Place> {
  if (message.channel.startsWith('D')) return { id: message.channel, name: null, dm: true };
  try {
    const info = await deps.slack.conversationInfo(conn.signIn, message.channel);
    return { id: message.channel, name: info.name, dm: info.isIm || info.isMpim };
  } catch (error) {
    await slackFailed(deps, conn, error, 'slack inbound: could not read a conversation');
    return { id: message.channel, name: null, dm: message.channelType === 'mpim' };
  }
}

/** A person's name by Slack (with `users:read`), else as listed, else their id; and the names of those it mentions. */
export async function namesOf(
  deps: InboundDeps,
  conn: Connection,
  people: readonly SlackPerson[],
  message: SlackInboundMessage,
): Promise<{ readonly from: string; readonly names: Map<string, string> }> {
  const names = new Map<string, string>();
  for (const person of people) names.set(person.id, person.name);
  if (conn.bot.userId !== null && conn.bot.name !== null) names.set(conn.bot.userId, conn.bot.name);
  const author = message.user as string;
  const ids = [author, ...mentionedIds(message.text)].filter((id) => id !== conn.bot.userId);
  if (slackAllows('users', 'slack_bot_token', conn.bot.scopes)) {
    for (const id of [...new Set(ids)].slice(0, NAMES_MAX)) {
      try {
        const user = await deps.slack.userInfo(conn.signIn, id);
        names.set(id, user.realName ?? user.displayName ?? user.name);
      } catch (error) {
        await slackFailed(deps, conn, error, 'slack inbound: could not read a person');
      }
    }
  }
  return { from: names.get(author) ?? author, names };
}

/** The listed people of the connection's row. */
export const peopleOf = (row: { readonly people: unknown }) => storedPeople(row.people);

/** Adds 👀 to the message, when the bot may react. */
export async function reactEyes(deps: InboundDeps, conn: Connection, message: SlackInboundMessage) {
  if (!slackAllows('react', 'slack_bot_token', conn.bot.scopes)) return;
  try {
    await deps.slack.addReaction(conn.signIn, {
      channel: message.channel,
      timestamp: message.ts,
      name: 'eyes',
    });
  } catch (error) {
    await slackFailed(deps, conn, error, 'slack inbound: could not react to a message');
  }
}

/** Posts a notice in the message's thread as the bot, unless one of this kind was posted in the last hour. */
export async function notice(
  deps: InboundDeps,
  conn: Connection,
  where: { readonly key: string; readonly channel: string; readonly threadTs: string | null },
  text: string,
): Promise<void> {
  const now = deps.clock().getTime();
  const last = conn.notices.get(where.key);
  if (last !== undefined && now - last < NOTICE_EVERY_MS) return;
  conn.notices.set(where.key, now);
  try {
    await postIn(deps.slack, conn.signIn, where, text);
  } catch (error) {
    await slackFailed(deps, conn, error, 'slack inbound: could not post a notice');
  }
}

/** Posts in the thread as the bot, every time (a turn that could not start). */
export async function say(
  deps: InboundDeps,
  conn: Connection,
  where: { readonly channel: string; readonly threadTs: string | null },
  text: string,
): Promise<void> {
  try {
    await postIn(deps.slack, conn.signIn, where, text);
  } catch (error) {
    await slackFailed(deps, conn, error, 'slack inbound: could not post a notice');
  }
}
