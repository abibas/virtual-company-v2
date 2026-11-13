import { z } from 'zod';

/**
 * The Slack tools' names and inputs (S7.1e, docs/subscriptions.md "Slack"): the reference Slack MCP server's
 * (`modelcontextprotocol/servers`, the names Slack's own MCP server shares: `slack_<verb>_<thing>`), so an agent's habits
 * carry over, with `slack_search_messages` for a user token's search. `channel_id` takes a channel's id (`C…`), its name
 * (`#general`), a DM's id (`D…`) or, to post a DM, a person's id (`U…`). What would make a post show as someone or
 * something else, or ping more people than it names, is refused by name (`REFUSED_ARGUMENTS`). Nothing deletes, edits,
 * invites, kicks or administers: there is no such tool. The server checks every call's input with these schemas; the
 * runner only relays them.
 */

export const SLACK_READ_TOOLS = [
  'slack_list_channels',
  'slack_get_channel_history',
  'slack_get_thread_replies',
  'slack_get_users',
  'slack_get_user_profile',
] as const;
export const SLACK_POST_TOOLS = ['slack_post_message', 'slack_reply_to_thread'] as const;

export const SlackTool = z.enum([
  ...SLACK_READ_TOOLS,
  ...SLACK_POST_TOOLS,
  'slack_add_reaction',
  'slack_search_messages',
]);
export type SlackTool = z.infer<typeof SlackTool>;

/** The longest message a tool posts: Slack's own limit for a message's text. */
export const TEXT_MAX = 40_000;

/** A message's timestamp, its id in its conversation (`1731490000.000100`). */
export const TS_PATTERN = /^\d{1,12}\.\d{1,8}$/;

const channel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('The channel: its id (C0123ABCD), its name (#general), or a DM’s id (D0123ABCD)');
const ts = (what: string) => z.string().trim().regex(TS_PATTERN, 'a Slack message timestamp').describe(what);
const cursor = z
  .string()
  .trim()
  .max(500)
  .optional()
  .describe('Pagination cursor from the last answer’s next_cursor');
const limit = (max: number, fallback: number) =>
  z.int().min(1).max(max).optional().describe(`How many to return (at most ${max}, ${fallback} by default)`);
const text = z.string().min(1).max(TEXT_MAX).describe('The message text (Slack mrkdwn)');

/** Each tool's input. */
export const SLACK_INPUTS = {
  slack_list_channels: z.object({ limit: limit(200, 100), cursor }),
  slack_get_channel_history: z.object({
    channel_id: channel,
    limit: limit(100, 10),
    cursor,
    oldest: z.string().trim().max(30).optional().describe('Only messages after this timestamp'),
    latest: z.string().trim().max(30).optional().describe('Only messages before this timestamp'),
  }),
  slack_get_thread_replies: z.object({
    channel_id: channel,
    thread_ts: ts('The thread’s first message’s timestamp'),
    limit: limit(200, 100),
    cursor,
  }),
  slack_get_users: z.object({ limit: limit(200, 100), cursor }),
  slack_get_user_profile: z.object({
    user_id: z
      .string()
      .trim()
      .regex(/^[UW][A-Z0-9]{2,20}$/, 'a Slack user id')
      .describe('The user’s id (U0123ABCD)'),
  }),
  slack_post_message: z.object({
    channel_id: channel.describe(
      'Where to post: a channel’s id or #name, a DM’s id, or a person’s id (U…) for a direct message',
    ),
    text,
  }),
  slack_reply_to_thread: z.object({
    channel_id: channel,
    thread_ts: ts('The thread’s first message’s timestamp'),
    text,
  }),
  slack_add_reaction: z.object({
    channel_id: channel,
    timestamp: ts('The message’s timestamp'),
    reaction: z
      .string()
      .trim()
      .transform((name) => name.replace(/^:|:$/g, ''))
      .pipe(z.string().regex(/^[a-z0-9_+'-]{1,100}$/, 'an emoji name such as thumbsup'))
      .describe('The emoji’s name, without colons (thumbsup)'),
  }),
  slack_search_messages: z.object({
    query: z.string().trim().min(1).max(1000).describe('Slack search syntax (in:#channel, from:@user, …)'),
    count: limit(100, 20),
    page: z.int().min(1).max(100).optional().describe('Page number (1 by default)'),
    sort: z.enum(['score', 'timestamp']).optional().describe('Sort by relevance or time'),
    sort_dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  }),
} satisfies Record<SlackTool, z.ZodType>;

export type SlackInput<T extends SlackTool> = z.output<(typeof SLACK_INPUTS)[T]>;

const AS_AGENT =
  'Most Wanted posts under the agent’s own name and icon when the bot may, else as the bot; that is not chosen per post.';
const PLAIN = 'Posts are plain text (Slack mrkdwn) only.';

/** Arguments that would change who a post shows as, or how far it reaches, refused by name. */
const POST_REFUSED: Readonly<Record<string, string>> = {
  username: AS_AGENT,
  icon_emoji: AS_AGENT,
  icon_url: AS_AGENT,
  as_user: AS_AGENT,
  blocks: PLAIN,
  attachments: PLAIN,
  link_names: 'Mentions are written as <@U0123ABCD>; @here, @channel and @everyone are never sent.',
  parse: 'Mentions are written as <@U0123ABCD>; @here, @channel and @everyone are never sent.',
  reply_broadcast: 'A thread reply stays in its thread: it is never sent to the channel too.',
};

export const REFUSED_ARGUMENTS: Partial<Record<SlackTool, Readonly<Record<string, string>>>> = {
  slack_post_message: POST_REFUSED,
  slack_reply_to_thread: POST_REFUSED,
};
