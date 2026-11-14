import { ownedIn, type TenantDb } from '@mwc/db';
import { isSlackError } from '@mwc/tools-core';
import type { InboundReply, InboundTurnHook, SystemTurnEnd } from '../../../../chats/index.ts';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { integrationsRepo } from '../../../repo.ts';
import { botOf } from '../../../rules/slack/inbound/event.ts';
import { answerText, couldNotAnswer, messageLink } from '../../../rules/slack/inbound/words.ts';
import { excerpt } from '../../reply.ts';
import { type InboundDeps, postedAs, postIn } from './context.ts';

/**
 * An agent's answer to a Slack message (2026-11-13, docs/subscriptions.md "Slack: receiving messages"), the chats'
 * `InboundTurnHook`: when a turn Most Wanted queued in a Slack conversation's chat ends, its final reply is posted in
 * that thread (or DM) under the agent's name (a bot with `chat:write.customize`, as the agent's tools post), unless the
 * agent already posted there in that turn with its own tools; a turn that failed (or never started) says "Couldn't
 * answer: …"; a stopped one says nothing. The bot sign-in is opened for `inbound_reply`, the post recorded (a reply in
 * the thread comes back to this agent) and audited as the agent. Never throws: a failure is logged. Since 2026-11-14 it
 * gives back the posted reply's link (the agent's own post, when it posted itself), which the turn keeps for "Posted
 * in Slack".
 */

/** A post's link in the sign-in's workspace; undefined without the workspace's address or the post's ts. */
const linkOf = (
  url: string | null,
  post: { readonly channel: string; readonly ts: string; readonly threadTs: string | null },
) => {
  const link = post.ts === '' ? null : messageLink(url, post);
  return link === null ? undefined : { link };
};

/** Posts the turn's answer (see above); where it went. */
async function answer(deps: InboundDeps, t: TenantDb, end: SystemTurnEnd): Promise<InboundReply | undefined> {
  if (end.status !== 'done' && end.status !== 'failed') return undefined;
  const thread = await repo.threadOfChat(t, end.chatId);
  if (thread === undefined) return undefined;
  const done = end.status === 'done';
  const reply = done ? (end.resultText ?? '').trim() : couldNotAnswer(end.error);
  if (reply === '') return undefined;
  const owner = await repo.ownerOfSignIn(t, thread.credentialId);
  const agent = await repo.liveAgent(t, thread.agentId);
  if (owner === undefined || agent === undefined) return undefined;
  const o = ownedIn(t, owner);
  const turn = { credentialId: thread.credentialId, turnId: end.turnId, channelId: thread.channelId };
  const own = done ? await repo.postedInTurn(o, turn, thread.threadTs) : undefined;
  if (own !== undefined) {
    const sign = await repo.signInOf(o, thread.credentialId);
    const url = sign === undefined ? null : botOf(sign.accountMeta).url;
    return linkOf(url, { channel: own.channelId, ts: own.ts, threadTs: own.threadTs });
  }
  const use = {
    companyId: t.companyId,
    agentId: agent.id,
    chatId: end.chatId,
    principalId: agent.principalId,
  };
  const opened = await deps.credentials.slackBot(thread.credentialId, owner, {
    purpose: 'inbound_reply',
    ...use,
  });
  if (!opened.ok) {
    deps.logger.warn(
      { credentialId: thread.credentialId },
      `slack inbound: no answer posted: ${opened.message}`,
    );
    return undefined;
  }
  const where = { channel: thread.channelId, threadTs: thread.threadTs };
  const text = done ? answerText(reply) : reply;
  const posted = await postIn(
    deps.slack,
    { token: opened.token },
    where,
    text,
    postedAs(botOf(opened.meta), agent),
  );
  const channelId = posted.channel || thread.channelId;
  if (posted.ts !== '') {
    const at = deps.clock();
    await repo.recordPost(o, { ...turn, channelId, ts: posted.ts, threadTs: thread.threadTs, at, ...use });
  }
  await integrationsRepo.audit(t, {
    actorKind: 'agent',
    actorPrincipalId: agent.principalId,
    requestId: end.turnId,
    entityType: 'slack_message',
    entityId: `${channelId}/${posted.ts}`,
    action: done ? 'slack_reply' : 'slack_reply_failed',
    changes: [
      { field: 'place', old: null, new: thread.place },
      ...(thread.threadTs === null
        ? []
        : [{ field: 'thread', old: null, new: `${channelId}/${thread.threadTs}` }]),
      { field: 'text', old: null, new: excerpt(text) },
    ],
  });
  return linkOf(botOf(opened.meta).url, { channel: channelId, ts: posted.ts, threadTs: thread.threadTs });
}

/** The hook on these deps. */
export function slackReplies(deps: InboundDeps): InboundTurnHook {
  return {
    async ended(t, end) {
      try {
        return await answer(deps, t, end);
      } catch (error) {
        if (isSlackError(error))
          deps.logger.warn(
            { code: error.code, turnId: end.turnId },
            'slack inbound: the answer was not posted',
          );
        else
          deps.logger.error({ err: error, turnId: end.turnId }, 'slack inbound: the answer was not posted');
        return undefined;
      }
    },
  };
}
