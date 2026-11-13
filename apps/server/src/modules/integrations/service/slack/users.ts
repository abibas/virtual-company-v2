import { slackAllows } from '@mwc/shared/credentials';
import { isSlackError, type SlackMessage } from '@mwc/tools-core';
import { userName, userView } from '../../rules/slack/render.ts';
import type { SlackInput } from '../../schemas/slack.ts';
import { done, type ToolReply } from '../reply.ts';
import type { SlackContext } from './context.ts';

/**
 * The Slack users' tools (S7.1e), and the names a message's authors show under in an answer: each author's id read with
 * `users.info` once per call, at most `NAMES_MAX` of them, when the token has `users:read` (else the ids stay).
 */

/** The most authors one answer names. */
export const NAMES_MAX = 15;

/** The names of these messages' authors, by id. */
export async function authorNames(
  ctx: SlackContext,
  messages: readonly SlackMessage[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!slackAllows('users', ctx.access.kind, ctx.access.scopes)) return names;
  const ids = [...new Set(messages.flatMap((message) => message.user ?? []))].slice(0, NAMES_MAX);
  for (const id of ids) {
    try {
      names.set(id, userName(await ctx.api.userInfo(ctx.signIn, id)));
    } catch (error) {
      if (!isSlackError(error) || error.code === 'needs_sign_in') throw error;
    }
  }
  return names;
}

/** `slack_get_users`: a page of the workspace's people and bots. */
export async function getUsers(ctx: SlackContext, input: SlackInput<'slack_get_users'>): Promise<ToolReply> {
  const page = await ctx.api.listUsers(ctx.signIn, { limit: input.limit ?? 100, cursor: input.cursor });
  return done({
    users: page.items.map(userView),
    ...(page.nextCursor === null ? {} : { next_cursor: page.nextCursor }),
  });
}

/** `slack_get_user_profile`: one person. */
export async function getUserProfile(
  ctx: SlackContext,
  input: SlackInput<'slack_get_user_profile'>,
): Promise<ToolReply> {
  return done(userView(await ctx.api.userInfo(ctx.signIn, input.user_id)));
}
