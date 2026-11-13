import {
  effectiveSlackRights,
  type SlackCapability,
  type SlackGap,
  type SlackRights,
  slackAllows,
  slackChannelWords,
  slackGap,
  slackGapWords,
} from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { SlackTool } from '../../schemas/slack.ts';

/**
 * Which Slack tools a profile's Slack part gives (S7.1e), and the server's check of each call against it: its rights as
 * its token's scopes let them work (`effectiveSlackRights`), so a right whose scopes the token lacks gives no tool and is
 * refused naming the scope; and the channels allowlist (`all`, or names and ids) with DMs apart. A refusal is a sentence
 * the agent reads.
 */

/** A Slack part as its tools read it: its rights as chosen, its token's kind and scopes. */
export interface SlackAccess {
  readonly rights: SlackRights;
  readonly kind: CredentialKind;
  readonly scopes: readonly string[];
}

/** The rights as the token lets them work. */
export const workingRights = (access: SlackAccess): SlackRights =>
  effectiveSlackRights(access.rights, access.kind, access.scopes);

const reads = (rights: SlackRights) => rights.read || rights.dms !== 'off';
const posts = (rights: SlackRights) => rights.post || rights.dms === 'post';

/** True when these rights (and the users scope) give the tool. */
function gives(tool: SlackTool, rights: SlackRights, users: boolean): boolean {
  switch (tool) {
    case 'slack_list_channels':
    case 'slack_get_channel_history':
    case 'slack_get_thread_replies':
      return reads(rights);
    case 'slack_get_users':
    case 'slack_get_user_profile':
      return reads(rights) && users;
    case 'slack_post_message':
    case 'slack_reply_to_thread':
      return posts(rights);
    case 'slack_add_reaction':
      return rights.react;
    case 'slack_search_messages':
      return rights.search;
  }
}

/** The tools the part gives, in a fixed order. */
export function offeredSlackTools(access: SlackAccess): SlackTool[] {
  const rights = workingRights(access);
  const users = slackAllows('users', access.kind, access.scopes);
  return SlackTool.options.filter((tool) => gives(tool, rights, users));
}

/** What the part's owner chose for a tool's right, and the capabilities whose scopes it then needs. */
function chosen(tool: SlackTool, rights: SlackRights): readonly SlackCapability[] | undefined {
  const read: SlackCapability[] = rights.read ? ['read'] : rights.dms !== 'off' ? ['dmsRead'] : [];
  if (tool === 'slack_get_users' || tool === 'slack_get_user_profile')
    return read.length === 0 ? undefined : [...read, 'users'];
  if (tool === 'slack_post_message' || tool === 'slack_reply_to_thread')
    return rights.post ? ['post'] : rights.dms === 'post' ? ['dmsPost'] : undefined;
  if (tool === 'slack_add_reaction') return rights.react ? ['react'] : undefined;
  if (tool === 'slack_search_messages') return rights.search && rights.read ? ['read', 'search'] : undefined;
  return read.length === 0 ? undefined : read;
}

const OFF: Readonly<Record<'read' | 'post' | 'react' | 'search', string>> = {
  read: "Reading Slack is off for this agent's profile.",
  post: "Posting in Slack is off for this agent's profile: it may only read.",
  react: "Reactions are off for this agent's profile.",
  search: "Searching Slack is off for this agent's profile.",
};

const rightOf = (tool: SlackTool) =>
  tool === 'slack_add_reaction'
    ? 'react'
    : tool === 'slack_search_messages'
      ? 'search'
      : tool === 'slack_post_message' || tool === 'slack_reply_to_thread'
        ? 'post'
        : 'read';

/** Why the part refuses the tool now (its right is off, or the token lacks its scopes), or undefined. */
export function slackToolRefusal(tool: SlackTool, access: SlackAccess): string | undefined {
  if (offeredSlackTools(access).includes(tool)) return undefined;
  const needs = chosen(tool, access.rights);
  if (needs === undefined) return OFF[rightOf(tool)];
  const gaps = needs.flatMap((capability) => slackGap(capability, access.kind, access.scopes) ?? []);
  const gap: SlackGap = {
    missing: [...new Set(gaps.flatMap((one) => one.missing))],
    userToken: gaps.some((one) => one.userToken),
  };
  return (
    `The Slack sign-in of this agent's profile ${slackGapWords(gap)} for ${tool}: its owner adds it to the Slack ` +
    'app, reinstalls the app and adds the new token.'
  );
}

/** A conversation a call names, as the checks read it: its id, its name (none for a DM), and whether it is a DM. */
export interface ResolvedChannel {
  readonly id: string;
  readonly name: string | null;
  readonly dm: boolean;
}

/** What a call does in a conversation. */
export type ChannelAction = 'read' | 'post' | 'react';

/** A conversation in words: `#general`, or its id. */
export const channelWords = (channel: ResolvedChannel) =>
  channel.name === null ? channel.id : `#${channel.name}`;

/** True when the allowlist holds the channel, by its id or its name. */
export function channelInScope(channels: SlackRights['channels'], channel: ResolvedChannel): boolean {
  if (channels === 'all') return true;
  const name = channel.name?.toLowerCase();
  return channels.some((entry) => entry === channel.id || (name !== undefined && entry === name));
}

/** The allowlist in words: "#general, C0123ABCD", or "none". */
export const channelsWords = (channels: readonly string[]) =>
  channels.length === 0 ? 'none' : channels.map(slackChannelWords).join(', ');

/** Why the working rights refuse this action in this conversation, or undefined. */
export function channelRefusal(
  rights: SlackRights,
  channel: ResolvedChannel,
  action: ChannelAction,
): string | undefined {
  if (channel.dm) {
    if (rights.dms === 'off') return "Direct messages are off for this agent's profile.";
    if (action !== 'read' && rights.dms !== 'post')
      return "This agent's profile may only read direct messages.";
    return action === 'react' && !rights.react ? OFF.react : undefined;
  }
  const right = action === 'read' ? rights.read : action === 'post' ? rights.post : rights.react;
  if (!right) return action === 'read' ? "Reading channels is off for this agent's profile." : OFF[action];
  if (channelInScope(rights.channels, channel)) return undefined;
  const reach = channelsWords(rights.channels as readonly string[]);
  return `${channelWords(channel)} is outside the Slack channels this agent's profile reaches (${reach}).`;
}
