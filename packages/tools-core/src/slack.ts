/**
 * The Slack port (S7.1e, docs/subscriptions.md "Slack"): what the agents' Slack tools need of Slack's Web API, with the
 * results trimmed to what the server answers with. The connector (`connectors/slack`) implements it over
 * `https://slack.com/api/` with a bearer token; every method rejects with a `SlackError`. Nothing here deletes,
 * edits, invites, kicks or administers anything: there is no such method.
 */

/** A Slack sign-in as one call uses it: a bot's (`xoxb-`) or a user's (`xoxp-`) token, opened on the server. */
export interface SlackSignIn {
  readonly token: string;
}

/** The kinds of conversation Slack lists: public and private channels, DMs, group DMs. */
export type SlackConversationType = 'public_channel' | 'private_channel' | 'im' | 'mpim';

/** A channel, a DM or a group DM. */
export interface SlackChannel {
  readonly id: string;
  /** A channel's name (`general`); null for a DM. */
  readonly name: string | null;
  readonly isPrivate: boolean;
  /** A direct message with one person. */
  readonly isIm: boolean;
  /** A group DM. */
  readonly isMpim: boolean;
  readonly isArchived: boolean;
  /** Whether the token's bot or user is in it (Slack's `is_member`); null when Slack does not say. */
  readonly isMember: boolean | null;
  /** A DM's other person (a user id). */
  readonly user: string | null;
  readonly topic: string | null;
  readonly purpose: string | null;
  readonly members: number | null;
}

/** One message of a channel or a thread. */
export interface SlackMessage {
  readonly ts: string;
  /** Its author's user id; null for some bots' messages. */
  readonly user: string | null;
  readonly botId: string | null;
  /** A bot's or a customized post's name. */
  readonly username: string | null;
  readonly text: string;
  readonly subtype: string | null;
  /** The thread it is in or starts. */
  readonly threadTs: string | null;
  readonly replyCount: number;
  readonly reactions: readonly { readonly name: string; readonly count: number }[];
  /** Its files' names. */
  readonly files: readonly string[];
}

/** A page of a list, with the cursor of the next one (null: the last). */
export interface SlackPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** A person (or a bot) of the workspace. */
export interface SlackUser {
  readonly id: string;
  readonly name: string;
  readonly realName: string | null;
  readonly displayName: string | null;
  readonly title: string | null;
  readonly isBot: boolean;
  readonly deleted: boolean;
  readonly timeZone: string | null;
  /** Their avatar's address (72 px), when Slack gives one. */
  readonly image: string | null;
  /** Their email, only when the token has `users:read.email`. */
  readonly email: string | null;
}

/** A message search's hit. */
export interface SlackHit {
  readonly channel: {
    readonly id: string;
    readonly name: string | null;
    readonly isIm: boolean;
    readonly isMpim: boolean;
    readonly isPrivate: boolean;
  };
  readonly ts: string;
  readonly user: string | null;
  readonly username: string | null;
  readonly text: string;
  readonly permalink: string | null;
}

/** A page of a message search. */
export interface SlackSearchPage {
  readonly total: number;
  readonly page: number;
  readonly pages: number;
  readonly items: readonly SlackHit[];
}

/** A message to post: where, its text, the thread, and how it shows. */
export interface SlackPost {
  readonly channel: string;
  readonly text: string;
  readonly threadTs?: string | undefined;
  /** With `chat:write.customize`: the name and icon it shows under. */
  readonly username?: string | undefined;
  readonly iconEmoji?: string | undefined;
  readonly iconUrl?: string | undefined;
}

/** Where a posted message landed. */
export interface SlackPosted {
  readonly channel: string;
  readonly ts: string;
}

/** The calls the Slack tools make. */
export interface SlackApi {
  /** `conversations.list`: a page of the conversations of these types the token can see. */
  listConversations(
    signIn: SlackSignIn,
    query: {
      readonly types: readonly SlackConversationType[];
      readonly limit: number;
      readonly cursor?: string | undefined;
    },
  ): Promise<SlackPage<SlackChannel>>;
  /** `conversations.info`: one conversation by its id. */
  conversationInfo(signIn: SlackSignIn, channel: string): Promise<SlackChannel>;
  /** `conversations.open`: the DM with one person (its channel id), opened if needed. */
  openDm(signIn: SlackSignIn, user: string): Promise<string>;
  /** `conversations.history`: a page of a conversation's messages, newest first. */
  history(
    signIn: SlackSignIn,
    channel: string,
    query: {
      readonly limit: number;
      readonly cursor?: string | undefined;
      readonly oldest?: string | undefined;
      readonly latest?: string | undefined;
    },
  ): Promise<SlackPage<SlackMessage>>;
  /** `conversations.replies`: a page of a thread's messages, its first message first. */
  replies(
    signIn: SlackSignIn,
    channel: string,
    ts: string,
    query: { readonly limit: number; readonly cursor?: string | undefined },
  ): Promise<SlackPage<SlackMessage>>;
  /** `users.list`: a page of the workspace's people and bots. */
  listUsers(
    signIn: SlackSignIn,
    query: { readonly limit: number; readonly cursor?: string | undefined },
  ): Promise<SlackPage<SlackUser>>;
  /** `users.info`: one person by their id. */
  userInfo(signIn: SlackSignIn, user: string): Promise<SlackUser>;
  /** `users.lookupByEmail` (`users:read.email`): one person by their email. */
  lookupUserByEmail(signIn: SlackSignIn, email: string): Promise<SlackUser>;
  /** `chat.postMessage`: posts a message (`link_names` off, links not unfurled). */
  postMessage(signIn: SlackSignIn, post: SlackPost): Promise<SlackPosted>;
  /** `reactions.add`: adds an emoji reaction (its name without colons) to a message. */
  addReaction(
    signIn: SlackSignIn,
    reaction: { readonly channel: string; readonly timestamp: string; readonly name: string },
  ): Promise<void>;
  /** `search.messages` (a user token with `search:read`): a page of messages matching Slack's search syntax. */
  searchMessages(
    signIn: SlackSignIn,
    query: {
      readonly query: string;
      readonly count: number;
      readonly page: number;
      readonly sort?: 'score' | 'timestamp' | undefined;
      readonly sortDir?: 'asc' | 'desc' | undefined;
    },
  ): Promise<SlackSearchPage>;
}
