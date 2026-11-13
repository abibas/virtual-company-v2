import type { SlackChannel, SlackHit, SlackMessage, SlackUser } from '@mwc/tools-core';
import { compact, cut } from '../answer.ts';

/**
 * The Slack tools' answers (S7.1e): JSON trimmed to what an agent needs (`rules/answer.ts`): a conversation's id, name and
 * topic; a message's time, author (by name when known), text, thread and reactions; a person's names and title; a search
 * hit with its link. Empty fields are left out and long texts cut. Pure.
 */

/** A message's text in an answer: at most this many characters. */
export const MESSAGE_MAX = 4000;
/** A search hit's text. */
export const HIT_MAX = 1000;

/** A conversation as answers show it. */
export function channelView(channel: SlackChannel) {
  return compact({
    id: channel.id,
    name: channel.name === null ? null : `#${channel.name}`,
    dm: channel.isIm || channel.isMpim ? (channel.isMpim ? 'group' : 'direct') : null,
    user: channel.user,
    private: channel.isPrivate && !channel.isIm && !channel.isMpim ? true : null,
    member: channel.isMember,
    topic: channel.topic,
    purpose: channel.purpose,
    members: channel.members,
  });
}

/** When a timestamp was, as ISO 8601 (`1731490000.000100` → 2024-11-13T09:26:40Z); null when it is not one. */
export function tsTime(ts: string): string | null {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Math.floor(seconds) * 1000).toISOString() : null;
}

/** A message as answers show it, its author by name when `names` knows them. */
export function messageView(message: SlackMessage, names: ReadonlyMap<string, string>) {
  const thread = message.threadTs !== null && message.threadTs !== message.ts ? message.threadTs : null;
  return compact({
    ts: message.ts,
    at: tsTime(message.ts),
    user: message.user === null ? message.username : (names.get(message.user) ?? message.user),
    user_id: message.user,
    bot: message.botId === null ? null : (message.username ?? message.botId),
    subtype: message.subtype,
    text: cut(message.text, MESSAGE_MAX),
    thread_ts: thread,
    replies: message.replyCount > 0 ? message.replyCount : null,
    reactions: message.reactions.map((reaction) => `${reaction.name} ${reaction.count}`).join(', '),
    files: message.files,
  });
}

/** A person as answers show them. */
export function userView(user: SlackUser) {
  return compact({
    id: user.id,
    name: user.name,
    real_name: user.realName,
    display_name: user.displayName,
    title: user.title,
    bot: user.isBot ? true : null,
    deleted: user.deleted ? true : null,
    tz: user.timeZone,
  });
}

/** A person's name in a message: their display name, else their real name, else their handle. */
export const userName = (user: SlackUser) => user.displayName ?? user.realName ?? user.name;

/** A search hit as answers show it. */
export function hitView(hit: SlackHit) {
  return compact({
    channel: hit.channel.name === null ? null : `#${hit.channel.name}`,
    channel_id: hit.channel.id,
    ts: hit.ts,
    at: tsTime(hit.ts),
    user: hit.username ?? hit.user,
    text: cut(hit.text, HIT_MAX),
    permalink: hit.permalink,
  });
}
