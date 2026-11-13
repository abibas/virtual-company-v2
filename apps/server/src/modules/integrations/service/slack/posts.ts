import { slackAllows } from '@mwc/shared/credentials';
import { postIcon } from '../../rules/slack/icons.ts';
import { channelWords, type ResolvedChannel } from '../../rules/slack/rights.ts';
import { postBlocks, postName, stripMentions } from '../../rules/slack/text.ts';
import type { SlackInput } from '../../schemas/slack.ts';
import { done, excerpt, refused, type ToolReply } from '../reply.ts';
import { resolveChannel } from './channels.ts';
import { inChannel, type SlackContext } from './context.ts';

/**
 * The Slack write tools (S7.1e): a post, a thread reply and a reaction, once the conversation is resolved and the
 * profile may write there. A post's text loses every mention of many people (`stripMentions`), carries the footer "via
 * Most Wanted · <agent>" and, on a bot token with `chat:write.customize`, shows under the agent's name and emoji icon; a
 * user token posts as its person. Each is audited as the agent on the message.
 */

/** How a post shows: the agent's name and icon on a bot that may take them; else as the token's bot or person. */
function postedAs(ctx: SlackContext) {
  const { kind, scopes } = ctx.access;
  if (kind !== 'slack_bot_token' || !slackAllows('customize', kind, scopes)) return {};
  return { username: postName(ctx.agent.name), ...postIcon(ctx.agent) };
}

/** Who the post shows as, in the answer: the agent's name, the bot, or the person whose token it is. */
function shownAs(ctx: SlackContext, shown: { readonly username?: string }): string | null {
  if (shown.username !== undefined) return shown.username;
  return ctx.access.kind === 'slack_user_token' ? `${ctx.account} (a person's own account)` : ctx.account;
}

/** Posts `text` in a resolved conversation (a thread when `threadTs`), audited. */
async function post(ctx: SlackContext, channel: ResolvedChannel, text: string, threadTs?: string) {
  const { text: plain, stripped } = stripMentions(text);
  if (plain.trim() === '')
    return refused('The message is empty once its mentions of everyone are taken out.');
  return inChannel(ctx, channel, async () => {
    const shown = postedAs(ctx);
    const posted = await ctx.api.postMessage(ctx.signIn, {
      channel: channel.id,
      text: plain,
      threadTs,
      ...shown,
      blocks: postBlocks(plain, ctx.agent.name),
    });
    await ctx.audit({
      entityId: `${posted.channel}/${posted.ts}`,
      changes: [
        { field: 'channel', new: channelWords(channel) },
        ...(threadTs === undefined ? [] : [{ field: 'thread', new: threadTs }]),
        { field: 'text', new: excerpt(plain) },
        ...(stripped.length === 0 ? [] : [{ field: 'mentionsStripped', new: stripped }]),
      ],
    });
    return done({
      posted: true,
      channel: channelWords(channel),
      channel_id: posted.channel,
      ts: posted.ts,
      ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
      as: shownAs(ctx, shown),
      ...(stripped.length === 0 ? {} : { mentions_stripped: stripped }),
    });
  });
}

/** `slack_post_message`. */
export async function postMessage(ctx: SlackContext, input: SlackInput<'slack_post_message'>) {
  const resolved = await resolveChannel(ctx, input.channel_id, 'post');
  return resolved.ok ? post(ctx, resolved.channel, input.text) : refused(resolved.refusal);
}

/** `slack_reply_to_thread`. */
export async function replyToThread(ctx: SlackContext, input: SlackInput<'slack_reply_to_thread'>) {
  const resolved = await resolveChannel(ctx, input.channel_id, 'post');
  return resolved.ok ? post(ctx, resolved.channel, input.text, input.thread_ts) : refused(resolved.refusal);
}

/** `slack_add_reaction`: an emoji on a message, audited. */
export async function addReaction(
  ctx: SlackContext,
  input: SlackInput<'slack_add_reaction'>,
): Promise<ToolReply> {
  const resolved = await resolveChannel(ctx, input.channel_id, 'react');
  if (!resolved.ok) return refused(resolved.refusal);
  const { channel } = resolved;
  return inChannel(ctx, channel, async () => {
    await ctx.api.addReaction(ctx.signIn, {
      channel: channel.id,
      timestamp: input.timestamp,
      name: input.reaction,
    });
    await ctx.audit({
      entityId: `${channel.id}/${input.timestamp}`,
      changes: [
        { field: 'channel', new: channelWords(channel) },
        { field: 'reaction', new: input.reaction },
      ],
    });
    return done({ reacted: input.reaction, channel: channelWords(channel), ts: input.timestamp });
  });
}
