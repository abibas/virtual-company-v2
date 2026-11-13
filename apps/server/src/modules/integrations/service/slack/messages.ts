import { hitView, messageView } from '../../rules/slack/render.ts';
import { channelInScope } from '../../rules/slack/rights.ts';
import type { SlackInput } from '../../schemas/slack.ts';
import { done, refused, type ToolReply } from '../reply.ts';
import { resolveChannel } from './channels.ts';
import { inChannel, type SlackContext } from './context.ts';
import { authorNames } from './users.ts';

/**
 * The Slack read tools (S7.1e): a conversation's history and a thread, once the conversation is resolved and in the
 * profile's reach (`channels.ts`), with their authors by name; and a message search, whose results outside the
 * channels and DMs the profile reaches are dropped.
 */

/** `slack_get_channel_history`: a conversation's latest messages, newest first. */
export async function channelHistory(
  ctx: SlackContext,
  input: SlackInput<'slack_get_channel_history'>,
): Promise<ToolReply> {
  const resolved = await resolveChannel(ctx, input.channel_id, 'read');
  if (!resolved.ok) return refused(resolved.refusal);
  const { channel } = resolved;
  return inChannel(ctx, channel, async () => {
    const { cursor, oldest, latest } = input;
    const page = await ctx.api.history(ctx.signIn, channel.id, {
      limit: input.limit ?? 10,
      cursor,
      oldest,
      latest,
    });
    const names = await authorNames(ctx, page.items);
    return done({
      channel: channel.name === null ? channel.id : `#${channel.name}`,
      channel_id: channel.id,
      messages: page.items.map((message) => messageView(message, names)),
      ...(page.nextCursor === null ? {} : { next_cursor: page.nextCursor }),
    });
  });
}

/** `slack_get_thread_replies`: a thread's messages, its first message first. */
export async function threadReplies(
  ctx: SlackContext,
  input: SlackInput<'slack_get_thread_replies'>,
): Promise<ToolReply> {
  const resolved = await resolveChannel(ctx, input.channel_id, 'read');
  if (!resolved.ok) return refused(resolved.refusal);
  const { channel } = resolved;
  return inChannel(ctx, channel, async () => {
    const query = { limit: input.limit ?? 100, cursor: input.cursor };
    const page = await ctx.api.replies(ctx.signIn, channel.id, input.thread_ts, query);
    const names = await authorNames(ctx, page.items);
    return done({
      channel_id: channel.id,
      thread_ts: input.thread_ts,
      messages: page.items.map((message) => messageView(message, names)),
      ...(page.nextCursor === null ? {} : { next_cursor: page.nextCursor }),
    });
  });
}

/** `slack_search_messages`: a page of matches, kept to the channels and DMs the profile reaches. */
export async function searchMessages(
  ctx: SlackContext,
  input: SlackInput<'slack_search_messages'>,
): Promise<ToolReply> {
  const { rights } = ctx;
  const found = await ctx.api.searchMessages(ctx.signIn, {
    query: input.query,
    count: input.count ?? 20,
    page: input.page ?? 1,
    sort: input.sort,
    sortDir: input.sort_dir,
  });
  const kept = found.items.filter(({ channel }) =>
    channel.isIm || channel.isMpim
      ? rights.dms !== 'off'
      : channelInScope(rights.channels, { id: channel.id, name: channel.name, dm: false }),
  );
  return done({
    query: input.query,
    total: found.total,
    page: found.page,
    pages: found.pages,
    messages: kept.map(hitView),
    ...(kept.length < found.items.length ? { left_out: found.items.length - kept.length } : {}),
  });
}
