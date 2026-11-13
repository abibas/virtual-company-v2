import { ownedIn, type TenantDb } from '@mwc/db';
import { issueLines } from '@mwc/shared/flows';
import { isSlackError, type SlackApi } from '@mwc/tools-core';
import type { ServerToolTurn } from '../../../chats/index.ts';
import type { CredentialsForTools } from '../../../credentials/index.ts';
import type { TurnToolCall } from '../../../machines/index.ts';
import { slackInboundRepo } from '../../repo/slack-inbound.ts';
import type { IntegrationsRepo, SlackPart } from '../../repo.ts';
import { type SlackAccess, slackToolRefusal, workingRights } from '../../rules/slack/rights.ts';
import { REFUSED_ARGUMENTS, SLACK_INPUTS, SlackTool } from '../../schemas/slack.ts';
import { refused, type ToolReply } from '../reply.ts';
import { listChannels } from './channels.ts';
import type { SlackChange, SlackContext } from './context.ts';
import { channelHistory, searchMessages, threadReplies } from './messages.ts';
import { addReaction, postMessage, replyToThread } from './posts.ts';
import { getUserProfile, getUsers } from './users.ts';

/**
 * One call of a Slack tool (S7.1e), checked again on the server whatever the runner relayed: the tool is one of them, the
 * turn's profile (read now, so a change since the turn began counts) has a Slack part with a sign-in whose rights, as its
 * token's scopes let them work, give the tool; no argument asks for what is not offered; the input is valid. Then the
 * sign-in is opened for `tool:<name>` (a `credential_uses` row) and the tool runs, resolving and checking the
 * conversation it names; the token never leaves the server. Slack's refusals are answered in words, and an invalid or
 * revoked token marks the sign-in as needing a new one. A post or a reaction is audited as the agent on the message.
 */

export interface SlackCallDeps {
  readonly api: SlackApi;
  readonly credentials: CredentialsForTools;
  readonly repo: IntegrationsRepo;
  readonly clock: () => Date;
}

export const NO_PROFILE = 'This turn runs on no profile, so it has no Slack tools.';
export const NO_PART = "This agent's profile has no Slack part now.";
export const NO_SIGN_IN =
  "This agent's profile's Slack part has no sign-in now: its owner chooses one on Profiles.";
export const NO_AGENT = 'This turn has no agent to act as.';

const TOOLS = {
  slack_list_channels: listChannels,
  slack_get_channel_history: channelHistory,
  slack_get_thread_replies: threadReplies,
  slack_get_users: getUsers,
  slack_get_user_profile: getUserProfile,
  slack_post_message: postMessage,
  slack_reply_to_thread: replyToThread,
  slack_add_reaction: addReaction,
  slack_search_messages: searchMessages,
} as Record<SlackTool, (ctx: SlackContext, input: unknown) => Promise<ToolReply>>;

/** A Slack part as its tools read it. */
export const accessOf = (part: SlackPart): SlackAccess => ({
  rights: part.rights,
  kind: part.asUser ? 'slack_user_token' : 'slack_bot_token',
  scopes: part.scopes ?? [],
});

/** The tool's input checked: its arguments and its schema; or why not. */
function checkedInput(
  tool: SlackTool,
  call: TurnToolCall,
): { readonly input: unknown } | { readonly refusal: string } {
  const refusals = REFUSED_ARGUMENTS[tool] ?? {};
  const name = Object.keys(refusals).find((key) => call.input[key] !== undefined);
  if (name !== undefined) return { refusal: refusals[name] as string };
  const input = SLACK_INPUTS[tool].safeParse(call.input);
  if (input.success) return { input: input.data };
  return {
    refusal: `${tool} did nothing; fix its input and call it again:\n${issueLines(input.error.issues)}`,
  };
}

/** One call (see above). */
export async function callSlack(
  deps: SlackCallDeps,
  t: TenantDb,
  turn: ServerToolTurn,
  call: TurnToolCall,
): Promise<ToolReply> {
  const known = SlackTool.safeParse(call.tool);
  if (!known.success) return refused(`Unknown tool: ${call.tool}`);
  const tool = known.data;
  if (turn.profileId === null) return refused(NO_PROFILE);
  const part = await deps.repo.slackPart(t, turn.profileId);
  if (part === undefined) return refused(NO_PART);
  if (part.credentialId === null) return refused(NO_SIGN_IN);
  const access = accessOf(part);
  const rights = slackToolRefusal(tool, access);
  if (rights !== undefined) return refused(rights);
  const checked = checkedInput(tool, call);
  if ('refusal' in checked) return refused(checked.refusal);
  const agent = await deps.repo.agentOf(t, turn.agentPrincipalId);
  if (agent === undefined) return refused(NO_AGENT);
  const use = {
    purpose: `tool:${tool}` as const,
    companyId: t.companyId,
    agentId: agent.id,
    chatId: turn.chatId,
  };
  const opened = await deps.credentials.slack(part.credentialId, part.ownerUserId, {
    ...use,
    principalId: turn.by,
  });
  if (!opened.ok) return refused(opened.message);
  const audit = (change: SlackChange) =>
    deps.repo.audit(t, {
      actorKind: 'agent',
      actorPrincipalId: turn.agentPrincipalId,
      requestId: turn.turnId,
      entityType: 'slack_message',
      entityId: change.entityId,
      action: `tool:${tool}`,
      changes: change.changes.map((c) => ({ field: c.field, old: null, new: c.new })),
    });
  const credentialId = part.credentialId;
  const recordPost: SlackContext['recordPost'] = (posted) =>
    slackInboundRepo.recordPost(ownedIn(t, part.ownerUserId), {
      credentialId,
      channelId: posted.channel,
      ts: posted.ts,
      threadTs: posted.threadTs,
      companyId: t.companyId,
      agentId: agent.id,
      chatId: turn.chatId,
      turnId: turn.turnId,
      at: deps.clock(),
    });
  const ctx: SlackContext = {
    api: deps.api,
    signIn: { token: opened.signIn.token },
    access,
    rights: workingRights(access),
    account: part.account,
    agent,
    audit,
    recordPost,
  };
  try {
    return await TOOLS[tool](ctx, checked.input);
  } catch (error) {
    if (!isSlackError(error)) throw error;
    if (error.code === 'needs_sign_in')
      await deps.credentials.needsSignIn(part.credentialId, part.ownerUserId);
    return refused(error.message);
  }
}
