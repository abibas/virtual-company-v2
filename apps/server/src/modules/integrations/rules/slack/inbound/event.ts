import { type SlackPerson, slackScopesOf } from '@mwc/shared/credentials';
import type { SlackWake } from '@mwc/shared/enums';
import type { SlackInboundMessage } from '@mwc/tools-core';

/**
 * Which Slack messages wake an agent (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): a DM to the bot, a
 * message that mentions it, or a reply in a thread (an agent's thread, the service decides); never the bot's own
 * messages, another bot's, an edit or a deletion, or one with no author. Who may wake agents: anyone, or the people
 * listed. Pure.
 */

/** The bot of a Slack sign-in as its account details name it. */
export interface SlackBot {
  /** Its user id (`U…`), which mentions name. */
  readonly userId: string | null;
  readonly botId: string | null;
  /** Its name ("Airia BRO"). */
  readonly name: string | null;
  readonly teamId: string | null;
  /** The workspace's address (`https://airia.slack.com/`). */
  readonly url: string | null;
  readonly scopes: readonly string[];
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

/** A bot sign-in's account details as a `SlackBot`. */
export const botOf = (meta: Readonly<Record<string, unknown>>): SlackBot => ({
  userId: text(meta.userId),
  botId: text(meta.botId),
  name: text(meta.user),
  teamId: text(meta.teamId),
  url: text(meta.url),
  scopes: slackScopesOf(meta),
});

/** What a message is to the inbound rules: a DM, a mention of the bot, a thread reply; or why it is ignored. */
export type InboundKind = 'dm' | 'mention' | 'thread';
export type Ignored = 'own' | 'bot' | 'edit' | 'subtype' | 'no_author' | 'not_for_us';

/** The subtypes a person's message may have and still wake an agent. */
const PERSON_SUBTYPES = new Set(['thread_broadcast', 'file_share']);
const EDITS = new Set(['message_changed', 'message_deleted']);

/** A DM with the bot: Slack says `im`, or its id starts with `D`. */
export const isDirect = (message: Pick<SlackInboundMessage, 'channel' | 'channelType'>) =>
  message.channelType === 'im' || message.channel.startsWith('D');

/** True when the message is a reply in a thread (not the thread's first message). */
export const isThreadReply = (message: Pick<SlackInboundMessage, 'ts' | 'threadTs'>) =>
  message.threadTs !== null && message.threadTs !== message.ts;

/** What the message is (see above). */
export function inboundKind(
  message: SlackInboundMessage,
  bot: SlackBot,
): { readonly kind: InboundKind } | { readonly ignored: Ignored } {
  if (message.botId !== null || message.subtype === 'bot_message')
    return { ignored: message.botId !== null && message.botId === bot.botId ? 'own' : 'bot' };
  if (message.user !== null && message.user === bot.userId) return { ignored: 'own' };
  if (message.edited || (message.subtype !== null && EDITS.has(message.subtype))) return { ignored: 'edit' };
  if (message.subtype !== null && !PERSON_SUBTYPES.has(message.subtype)) return { ignored: 'subtype' };
  if (message.user === null) return { ignored: 'no_author' };
  if (isDirect(message)) return { kind: 'dm' };
  const mentioned = bot.userId !== null && message.text.includes(`<@${bot.userId}`);
  if (message.type === 'app_mention' || mentioned) return { kind: 'mention' };
  return isThreadReply(message) ? { kind: 'thread' } : { ignored: 'not_for_us' };
}

/** One message's key: Slack sends a mention as `app_mention` and as `message` both. */
export const messageKey = (message: Pick<SlackInboundMessage, 'channel' | 'ts'>) =>
  `${message.channel}/${message.ts}`;

/**
 * The Slack conversation a message belongs to: its thread's first message, or the message itself (its answer starts a
 * thread under it); null for a DM's message in no thread (the DM itself is the conversation).
 */
export const threadRoot = (
  message: Pick<SlackInboundMessage, 'channel' | 'channelType' | 'ts' | 'threadTs'>,
) => message.threadTs ?? (isDirect(message) ? null : message.ts);

/** True when this person may wake agents through the connection. */
export function mayWake(
  settings: { readonly wake: SlackWake; readonly people: readonly SlackPerson[] },
  user: string,
): boolean {
  return settings.wake === 'anyone' || settings.people.some((person) => person.id === user);
}

/** Keys seen lately, the oldest forgotten past `max`. */
export function recentKeys(max: number) {
  const seen = new Set<string>();
  return (key: string): boolean => {
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > max) seen.delete(seen.values().next().value as string);
    return false;
  };
}
