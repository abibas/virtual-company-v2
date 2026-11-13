import { SLACK_CHANNEL_ID_PATTERN, slackAllows } from '@mwc/shared/credentials';
import type { SlackConversationType } from '@mwc/tools-core';
import { channelView } from '../../rules/slack/render.ts';
import {
  type ChannelAction,
  channelInScope,
  channelRefusal,
  type ResolvedChannel,
} from '../../rules/slack/rights.ts';
import type { SlackInput } from '../../schemas/slack.ts';
import { done, type ToolReply } from '../reply.ts';
import type { SlackContext } from './context.ts';

/**
 * The conversations a Slack call names (S7.1e), resolved and checked before it runs: a DM by its id (`D…`); a person
 * (`U…`) only to post them a DM, which is opened; a channel by its id (read with `conversations.info` unless the
 * allowlist names that id) or by its name (`#general`, found in the channels the sign-in sees), then checked against
 * the allowlist and the DM rights. And `slack_list_channels`: one page of what the sign-in sees, kept to that.
 */

/** The most pages of 200 a name is looked for in: the first 1000 channels. */
export const NAME_PAGES = 5;

/** A resolved conversation, or why the call may not use it. */
export type Resolved =
  | { readonly ok: true; readonly channel: ResolvedChannel }
  | { readonly ok: false; readonly refusal: string };

const refuse = (refusal: string): Resolved => ({ ok: false, refusal });

/** The channel types the sign-in reads: public ones, private ones with their scopes. */
function channelTypes(ctx: SlackContext): SlackConversationType[] {
  const { kind, scopes } = ctx.access;
  return slackAllows('privateChannels', kind, scopes)
    ? ['public_channel', 'private_channel']
    : ['public_channel'];
}

/** A channel by its name, among the first `NAME_PAGES` pages the sign-in sees; undefined when it is not there. */
async function byName(ctx: SlackContext, name: string): Promise<ResolvedChannel | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < NAME_PAGES; page++) {
    const found = await ctx.api.listConversations(ctx.signIn, {
      types: channelTypes(ctx),
      limit: 200,
      cursor,
    });
    const channel = found.items.find((item) => item.name?.toLowerCase() === name);
    if (channel) return { id: channel.id, name: channel.name, dm: channel.isIm || channel.isMpim };
    if (found.nextCursor === null) return undefined;
    cursor = found.nextCursor;
  }
  return undefined;
}

/** The conversation `input` names, before any check. */
async function lookUp(ctx: SlackContext, input: string, action: ChannelAction): Promise<Resolved> {
  if (/^D[A-Z0-9]{2,20}$/.test(input)) return { ok: true, channel: { id: input, name: null, dm: true } };
  if (/^[UW][A-Z0-9]{2,20}$/.test(input)) {
    if (action !== 'post')
      return refuse('A person’s id (U…) only posts a direct message; name a channel or a DM’s id.');
    const dm = channelRefusal(ctx.rights, { id: input, name: null, dm: true }, 'post');
    if (dm !== undefined) return refuse(dm);
    return { ok: true, channel: { id: await ctx.api.openDm(ctx.signIn, input), name: null, dm: true } };
  }
  if (SLACK_CHANNEL_ID_PATTERN.test(input)) {
    const { channels } = ctx.rights;
    if (channels !== 'all' && channels.includes(input))
      return { ok: true, channel: { id: input, name: null, dm: false } };
    const info = await ctx.api.conversationInfo(ctx.signIn, input);
    return { ok: true, channel: { id: info.id || input, name: info.name, dm: info.isIm || info.isMpim } };
  }
  const name = input.replace(/^#/, '').toLowerCase();
  const found = await byName(ctx, name);
  return found
    ? { ok: true, channel: found }
    : refuse(`No channel #${name} that this Slack sign-in can see.`);
}

/** The conversation `input` names, checked for this action (see above). */
export async function resolveChannel(
  ctx: SlackContext,
  input: string,
  action: ChannelAction,
): Promise<Resolved> {
  const found = await lookUp(ctx, input.trim(), action);
  if (!found.ok) return found;
  const refusal = channelRefusal(ctx.rights, found.channel, action);
  return refusal === undefined ? found : refuse(refusal);
}

/** `slack_list_channels`: a page of the conversations the sign-in sees, kept to the channels and DMs it may read. */
export async function listChannels(
  ctx: SlackContext,
  input: SlackInput<'slack_list_channels'>,
): Promise<ToolReply> {
  const { rights } = ctx;
  const types: SlackConversationType[] = [
    ...(rights.read ? channelTypes(ctx) : []),
    ...(rights.dms === 'off' ? [] : (['im', 'mpim'] as const)),
  ];
  const page = await ctx.api.listConversations(ctx.signIn, {
    types,
    limit: input.limit ?? 100,
    cursor: input.cursor,
  });
  const kept = page.items.filter((item) =>
    item.isIm || item.isMpim
      ? rights.dms !== 'off'
      : rights.read && channelInScope(rights.channels, { id: item.id, name: item.name, dm: false }),
  );
  return done({
    channels: kept.map(channelView),
    ...(kept.length < page.items.length ? { left_out: page.items.length - kept.length } : {}),
    ...(page.nextCursor === null ? {} : { next_cursor: page.nextCursor }),
  });
}
