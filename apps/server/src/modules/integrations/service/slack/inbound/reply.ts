import { ownedIn, type TenantDb } from '@mwc/db';
import { isSlackError } from '@mwc/tools-core';
import type { InboundTurnHook, SystemTurnEnd } from '../../../../chats/index.ts';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { integrationsRepo } from '../../../repo.ts';
import { botOf } from '../../../rules/slack/inbound/event.ts';
import { answerText, couldNotAnswer } from '../../../rules/slack/inbound/words.ts';
import { excerpt } from '../../reply.ts';
import { type InboundDeps, postedAs, postIn } from './context.ts';

/**
 * An agent's answer to a Slack message (2026-11-13, docs/subscriptions.md "Slack: receiving messages"), the chats'
 * `InboundTurnHook`: when a turn Most Wanted queued in a Slack conversation's chat ends, its final reply is posted in
 * that thread (or DM) under the agent's name (a bot with `chat:write.customize`, as the agent's tools post), unless the
 * agent already posted there in that turn with its own tools; a turn that failed (or never started) says "Couldn't
 * answer: …"; a stopped one says nothing. The bot sign-in is opened for `inbound_reply`, the post recorded (a reply in
 * the thread comes back to this agent) and audited as the agent. Never throws: a failure is logged.
 */

/** Posts the turn's answer (see above). */
async function answer(deps: InboundDeps, t: TenantDb, end: SystemTurnEnd): Promise<void> {
  if (end.status !== 'done' && end.status !== 'failed') return;
  const thread = await repo.threadOfChat(t, end.chatId);
  if (thread === undefined) return;
  const done = end.status === 'done';
  const reply = done ? (end.resultText ?? '').trim() : couldNotAnswer(end.error);
  if (reply === '') return;
  const owner = await repo.ownerOfSignIn(t, thread.credentialId);
  const agent = await repo.liveAgent(t, thread.agentId);
  if (owner === undefined || agent === undefined) return;
  const o = ownedIn(t, owner);
  const turn = { credentialId: thread.credentialId, turnId: end.turnId, channelId: thread.channelId };
  if (done && (await repo.postedInTurn(o, turn, thread.threadTs))) return;
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
    return;
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
}

/** The hook on these deps. */
export function slackReplies(deps: InboundDeps): InboundTurnHook {
  return {
    async ended(t, end) {
      try {
        await answer(deps, t, end);
      } catch (error) {
        if (isSlackError(error))
          deps.logger.warn(
            { code: error.code, turnId: end.turnId },
            'slack inbound: the answer was not posted',
          );
        else
          deps.logger.error({ err: error, turnId: end.turnId }, 'slack inbound: the answer was not posted');
      }
    },
  };
}
