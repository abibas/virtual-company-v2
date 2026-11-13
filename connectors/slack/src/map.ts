import type {
  SlackChannel,
  SlackHit,
  SlackMessage,
  SlackPage,
  SlackSearchPage,
  SlackUser,
} from '@mwc/tools-core';

/**
 * Slack's answers read into the port's shapes (S7.1e): only the fields the tools use, each checked for its type, so a
 * field Slack leaves out or changes reads as empty rather than failing a whole answer.
 */

type Raw = Record<string, unknown>;

const obj = (value: unknown): Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const bool = (value: unknown): boolean => value === true;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The cursor of the next page (`response_metadata.next_cursor`; empty: the last page). */
export const nextCursor = (body: Raw): string | null => str(obj(body.response_metadata).next_cursor);

/** A page of items read with `read`. */
export const pageOf = <T>(body: Raw, field: string, read: (raw: Raw) => T): SlackPage<T> => ({
  items: list(body[field]).map((item) => read(obj(item))),
  nextCursor: nextCursor(body),
});

/** A conversation: a channel, a DM or a group DM. */
export function channelOf(raw: Raw): SlackChannel {
  return {
    id: str(raw.id) ?? '',
    name: str(raw.name),
    isPrivate: bool(raw.is_private),
    isIm: bool(raw.is_im),
    isMpim: bool(raw.is_mpim),
    isArchived: bool(raw.is_archived),
    isMember: typeof raw.is_member === 'boolean' ? raw.is_member : null,
    user: str(raw.user),
    topic: str(obj(raw.topic).value),
    purpose: str(obj(raw.purpose).value),
    members: num(raw.num_members),
  };
}

/** A message of a channel or a thread. */
export function messageOf(raw: Raw): SlackMessage {
  return {
    ts: str(raw.ts) ?? '',
    user: str(raw.user),
    botId: str(raw.bot_id),
    username: str(raw.username) ?? str(obj(raw.bot_profile).name),
    text: typeof raw.text === 'string' ? raw.text : '',
    subtype: str(raw.subtype),
    threadTs: str(raw.thread_ts),
    replyCount: num(raw.reply_count) ?? 0,
    reactions: list(raw.reactions).map((item) => {
      const reaction = obj(item);
      return { name: str(reaction.name) ?? '', count: num(reaction.count) ?? 0 };
    }),
    files: list(raw.files).flatMap((item) => str(obj(item).name) ?? []),
  };
}

/** A person or a bot of the workspace. */
export function userOf(raw: Raw): SlackUser {
  const profile = obj(raw.profile);
  return {
    id: str(raw.id) ?? '',
    name: str(raw.name) ?? '',
    realName: str(raw.real_name) ?? str(profile.real_name),
    displayName: str(profile.display_name),
    title: str(profile.title),
    isBot: bool(raw.is_bot),
    deleted: bool(raw.deleted),
    timeZone: str(raw.tz),
    image: str(profile.image_72) ?? str(profile.image_48),
    email: str(profile.email),
  };
}

/** A search hit. */
function hitOf(raw: Raw): SlackHit {
  const channel = obj(raw.channel);
  return {
    channel: {
      id: str(channel.id) ?? '',
      name: str(channel.name),
      isIm: bool(channel.is_im),
      isMpim: bool(channel.is_mpim),
      isPrivate: bool(channel.is_private),
    },
    ts: str(raw.ts) ?? '',
    user: str(raw.user),
    username: str(raw.username),
    text: typeof raw.text === 'string' ? raw.text : '',
    permalink: str(raw.permalink),
  };
}

/** `search.messages`'s answer: the total, the page and its hits. */
export function searchOf(body: Raw): SlackSearchPage {
  const messages = obj(body.messages);
  const paging = obj(messages.paging);
  return {
    total: num(messages.total) ?? 0,
    page: num(paging.page) ?? 1,
    pages: num(paging.pages) ?? 1,
    items: list(messages.matches).map((item) => hitOf(obj(item))),
  };
}

export { obj, str };
