import type { SlackRights } from '@mwc/shared/credentials';
import { isSlackError, type SlackApi, type SlackSignIn } from '@mwc/tools-core';
import { channelWords, type ResolvedChannel, type SlackAccess } from '../../rules/slack/rights.ts';
import { refused, type ToolReply } from '../reply.ts';

/**
 * What one Slack tool call works with (S7.1e): the port, the opened sign-in, the part as chosen (its rights, the token's
 * kind and scopes) and as it works, the agent it posts as, and how it records a post or a reaction (an audit row as the
 * agent, in its turn, on the message `<channel>/<ts>`).
 */

/** A post or reaction a tool made, as its audit rows say it. */
export interface SlackChange {
  /** `<channel id>/<ts>`. */
  readonly entityId: string;
  readonly changes: readonly { readonly field: string; readonly new: unknown }[];
}

export interface SlackContext {
  readonly api: SlackApi;
  readonly signIn: SlackSignIn;
  readonly access: SlackAccess;
  /** The rights as the token lets them work. */
  readonly rights: SlackRights;
  /** The sign-in's bot or person (its name), for the words of a refusal. */
  readonly account: string | null;
  /** The agent a post is made for: its name and icon. */
  readonly agent: { readonly name: string; readonly iconKind: string; readonly iconEmoji: string | null };
  readonly audit: (change: SlackChange) => Promise<void>;
  /** Records a message it posted (2026-11-13: a reply in its thread comes back to this agent). */
  readonly recordPost?: (posted: {
    readonly channel: string;
    readonly ts: string;
    readonly threadTs: string | null;
  }) => Promise<void>;
}

/** A tool's run in a conversation: Slack's `not_in_channel` said with the channel, and how to invite the bot. */
export async function inChannel(
  ctx: SlackContext,
  channel: ResolvedChannel,
  run: () => Promise<ToolReply>,
): Promise<ToolReply> {
  try {
    return await run();
  } catch (error) {
    if (!isSlackError(error) || error.code !== 'not_in_channel') throw error;
    const where = channelWords(channel);
    const bot = ctx.account === null ? '' : ` (/invite @${ctx.account})`;
    return refused(`The bot is not in ${where}: invite the bot to ${where} in Slack${bot}, then try again.`);
  }
}
