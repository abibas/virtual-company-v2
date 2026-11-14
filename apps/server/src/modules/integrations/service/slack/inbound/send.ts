import { type Agent, ownedIn, type SlackThread, type TenantDb } from '@mwc/db';
import { isSlackError, type SlackSignIn } from '@mwc/tools-core';
import type { ChatSlackHook, SlackPosted, SlackPostRequest } from '../../../../chats/index.ts';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { integrationsRepo } from '../../../repo.ts';
import { botOf } from '../../../rules/slack/inbound/event.ts';
import { messageLink } from '../../../rules/slack/inbound/words.ts';
import { channelRefusal, type ResolvedChannel, workingRights } from '../../../rules/slack/rights.ts';
import { excerpt } from '../../reply.ts';
import { accessOf } from '../call.ts';
import { type InboundDeps, postIn } from './context.ts';

/**
 * Send in Slack (2026-11-14, docs/subscriptions.md "Send in Slack"), the chats' `ChatSlackHook`: in a Slack
 * conversation's chat, the Slack connection's owner posts a message straight into that conversation (its thread, or the
 * DM) through the bot, as the bot (no agent's name), with no agent turn. Only the owner; only while the chat's agent
 * still posts through that bot (its profile's Slack part) and its rights let it post there (the channels it reaches,
 * DMs with posting on). The bot sign-in is opened for `chat_send`, the post recorded in `slack_posts` with the chat (a
 * reply to it comes back to this chat) and audited as the person. A refusal says why in words.
 */

const refused = (status: 403 | 409 | 422 | 503, code: string, message: string): SlackPosted => ({
  ok: false,
  status,
  code,
  message,
});

export const NOT_SLACK_CHAT = refused(409, 'not_slack_chat', 'This chat is not for a Slack conversation');
export const NOT_SLACK_OWNER = refused(
  403,
  'not_slack_owner',
  'Only the person who connected this Slack bot sends in Slack from here',
);
export const AGENT_GONE = refused(409, 'agent_archived', "The chat's agent is archived");

/** The agent's profile no longer posts through this bot. */
const notThisBot = (agent: Agent) =>
  refused(
    409,
    'slack_refused',
    `${agent.name}'s profile no longer posts through this Slack bot: choose the bot in its profile's Slack part`,
  );

/** A link to the conversation (its thread's first message, or the DM); null without the workspace's address. */
function conversationLink(url: string | null, thread: SlackThread): string | null {
  if (url === null) return null;
  if (thread.threadTs !== null)
    return messageLink(url, { channel: thread.channelId, ts: thread.threadTs, threadTs: null });
  return `${url.replace(/\/+$/, '')}/archives/${thread.channelId}`;
}

/** Where the conversation is, for the rights' check: a DM by its id, else as Slack describes it. */
async function placeOf(deps: InboundDeps, signIn: SlackSignIn, channelId: string): Promise<ResolvedChannel> {
  if (channelId.startsWith('D')) return { id: channelId, name: null, dm: true };
  const info = await deps.slack.conversationInfo(signIn, channelId);
  return { id: channelId, name: info.name, dm: info.isIm || info.isMpim };
}

/** The post (see above); Slack's refusals are the caller's to say. */
async function post(deps: InboundDeps, t: TenantDb, request: SlackPostRequest): Promise<SlackPosted> {
  const thread = await repo.threadOfChat(t, request.chatId);
  if (thread === undefined) return NOT_SLACK_CHAT;
  const owner = await repo.ownerOfSignIn(t, thread.credentialId);
  if (owner === undefined || owner !== request.userId) return NOT_SLACK_OWNER;
  const agent = await repo.liveAgent(t, thread.agentId);
  if (agent === undefined) return AGENT_GONE;
  const part = agent.profileId === null ? undefined : await integrationsRepo.slackPart(t, agent.profileId);
  if (part === undefined || part.credentialId !== thread.credentialId) return notThisBot(agent);
  const use = {
    companyId: t.companyId,
    agentId: agent.id,
    chatId: request.chatId,
    principalId: request.principalId,
  };
  const opened = await deps.credentials.slackBot(thread.credentialId, owner, {
    purpose: 'chat_send',
    ...use,
  });
  if (!opened.ok) return refused(422, 'credential_unusable', opened.message);
  const signIn = { token: opened.token };
  const place = await placeOf(deps, signIn, thread.channelId);
  const refusal = channelRefusal(workingRights(accessOf(part)), place, 'post');
  if (refusal !== undefined) return refused(409, 'slack_refused', refusal);
  const where = { channel: thread.channelId, threadTs: thread.threadTs };
  const posted = await postIn(deps.slack, signIn, where, request.text);
  const channelId = posted.channel || thread.channelId;
  if (posted.ts !== '') {
    const at = deps.clock();
    const row = { credentialId: thread.credentialId, channelId, ts: posted.ts, threadTs: thread.threadTs };
    await repo.recordPost(ownedIn(t, owner), { ...row, ...use, turnId: null, at });
  }
  await integrationsRepo.audit(t, {
    actorKind: 'user',
    actorPrincipalId: request.principalId,
    requestId: request.requestId,
    entityType: 'slack_message',
    entityId: `${channelId}/${posted.ts}`,
    action: 'slack_send',
    changes: [
      { field: 'place', old: null, new: thread.place },
      { field: 'chat', old: null, new: request.chatId },
      { field: 'text', old: null, new: excerpt(request.text) },
    ],
  });
  const url = botOf(opened.meta).url;
  const link =
    posted.ts === ''
      ? null
      : messageLink(url, { channel: channelId, ts: posted.ts, threadTs: thread.threadTs });
  return { ok: true, link };
}

/** The hook on these deps. */
export function slackSends(deps: InboundDeps): ChatSlackHook {
  return {
    async conversationOf(t, chatId, userId) {
      const thread = await repo.threadOfChat(t, chatId);
      if (thread === undefined) return null;
      const owner = await repo.ownerOfSignIn(t, thread.credentialId);
      const sign =
        owner === undefined ? undefined : await repo.signInOf(ownedIn(t, owner), thread.credentialId);
      const link = conversationLink(sign === undefined ? null : botOf(sign.accountMeta).url, thread);
      return { place: thread.place, link, mayPost: owner === userId };
    },
    async post(t, request) {
      try {
        return await post(deps, t, request);
      } catch (error) {
        if (!isSlackError(error)) throw error;
        deps.logger.warn({ code: error.code, chatId: request.chatId }, 'slack send: Slack refused the post');
        if (error.code === 'unavailable' || error.code === 'rate_limited')
          return refused(503, 'slack_unavailable', error.message);
        return refused(409, 'slack_refused', error.message);
      }
    },
  };
}
