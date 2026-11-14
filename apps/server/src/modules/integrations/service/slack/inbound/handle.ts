import { owned, type SlackConnection, type TenantDb } from '@mwc/db';
import type { SlackPerson } from '@mwc/shared/credentials';
import type { SlackInboundMessage } from '@mwc/tools-core';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { integrationsRepo } from '../../../repo.ts';
import { inboundKind, mayWake, messageKey, threadRoot } from '../../../rules/slack/inbound/event.ts';
import { inboundReach } from '../../../rules/slack/inbound/reach.ts';
import { joinedRoot } from '../../../rules/slack/inbound/scope.ts';
import { askedText, renderSlackText } from '../../../rules/slack/inbound/text.ts';
import {
  capWords,
  couldNotAnswer,
  inboundPrompt,
  messageLink,
  NO_DEFAULT_AGENT,
  notAllowedWords,
  type Place,
  placeWords,
  slackChatTitle,
} from '../../../rules/slack/inbound/words.ts';
import { workingRights } from '../../../rules/slack/rights.ts';
import { excerpt } from '../../reply.ts';
import { accessOf } from '../call.ts';
import type { Connection, HandleDeps } from './context.ts';
import { type ConversationKey, conversationOf, savesThread } from './conversation.ts';
import { namesOf, notice, peopleOf, placeOf, reactEyes, say } from './notice.ts';
import { type Picked, pickAgent } from './route.ts';
import { turnFrom } from './sender.ts';

/**
 * One Slack message received (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): a DM to the bot, a
 * mention of it, or a reply in a thread, never the bot's own, another bot's, an edit or a deletion; once, though Slack
 * sends a mention twice; only from someone the connection lets wake agents (others are logged quietly). The agent that
 * answers (`route.ts`) must reach the place by its profile's Slack part (outside its channels, or a DM with DMs off, is
 * ignored; without read and post there it says so once an hour), within the connection's hourly cap (said once, then
 * silence). Then 👀, and a turn in the agent's chat for that conversation (Keep context), whose prompt is the message
 * with names and a header; the wake is recorded (`inbound`) and audited. A turn that cannot start says why in the thread.
 * Since 2026-11-14 the sender's contact is made or updated first (`sender.ts`), and the turn and the conversation's chat
 * name it, the turn with the sender and the message as the reader sees it. Since 2026-11-14 the answer always goes into
 * the message's own thread, and the conversation is the thread's: a reply's, or the one a message in no thread points
 * to; else the message starts a new one (`rules/slack/inbound/scope.ts`, `conversation.ts`).
 */

export const HOUR_MS = 60 * 60_000;

/** A picked agent with where the message is. */
interface Wake {
  readonly settings: SlackConnection;
  readonly people: readonly SlackPerson[];
  readonly message: SlackInboundMessage;
  readonly picked: Extract<Picked, { readonly t: TenantDb }>;
  readonly place: Place;
  /** The thread whose conversation the message joins (a reply's, or the one it points to); null: a new one. */
  readonly joined: string | null;
}

/** The conversation the message goes on in: the joined thread's when it has one, else a new one at its own thread. */
async function conversationAt(deps: HandleDeps, conn: Connection, w: Wake) {
  const { message, picked, joined } = w;
  const base = { agentId: picked.agent.id, credentialId: conn.credentialId, channelId: message.channel };
  const own: ConversationKey = { ...base, threadTs: threadRoot(message) };
  if (joined === null) return { key: own, found: await conversationOf(deps, conn, picked.t, own) };
  const key = { ...base, threadTs: joined };
  const found = await conversationOf(deps, conn, picked.t, key);
  const pointedNowhere = found.chatId === null && joined !== message.threadTs;
  return pointedNowhere ? { key: own, found } : { key, found };
}

/** The agent's reach there, by its profile's Slack part on this sign-in. */
async function reachOf(conn: Connection, picked: Wake['picked'], place: Place) {
  const { profileId } = picked.agent;
  const part = profileId === null ? undefined : await integrationsRepo.slackPart(picked.t, profileId);
  const rights =
    part !== undefined && part.credentialId === conn.credentialId ? workingRights(accessOf(part)) : undefined;
  return inboundReach(rights, place);
}

/** True when the connection's wakes in the last hour reached its cap. */
async function overCap(deps: HandleDeps, conn: Connection, settings: SlackConnection): Promise<boolean> {
  const since = new Date(deps.clock().getTime() - HOUR_MS);
  const used = await deps.credentials.usesSince(conn.credentialId, conn.ownerUserId, 'inbound', since);
  return used >= settings.maxPerHour;
}

/** The turn in the agent's chat for the conversation (see above). */
async function wake(deps: HandleDeps, conn: Connection, w: Wake): Promise<void> {
  const { message, picked, place } = w;
  const { t, agent } = picked;
  const where = { channel: message.channel, threadTs: threadRoot(message) };
  await reactEyes(deps, conn, message);
  const { from, names, author } = await namesOf(deps, conn, w.people, message);
  const text = renderSlackText(message.text, names);
  const link = messageLink(conn.bot.url, message);
  const listed = w.people.find((person) => person.id === message.user);
  const sender = await turnFrom(deps, conn, t, { message, from, described: author, listed, link, text });
  const prompt = inboundPrompt({ from, place, link, threaded: true, text });
  const named = picked.how === 'named' ? agent.name : null;
  const title = slackChatTitle(
    place,
    renderSlackText(askedText(message.text, conn.bot.userId, named), names),
  );
  const { key, found } = await conversationAt(deps, conn, w);
  const reason = `Started for a Slack message from ${from} in ${placeWords(place)}`;
  const request = {
    agentPrincipalId: agent.principalId,
    chatId: found.chatId,
    title,
    prompt,
    reason,
    from: sender,
  };
  const sent = await deps.chats.send(t, request);
  if (!sent.ok) {
    deps.logger.info(
      { credentialId: conn.credentialId, code: sent.code },
      'slack inbound: the turn did not start',
    );
    return say(deps, conn, where, couldNotAnswer(sent.message));
  }
  const started = { chatId: sent.chatId, place: placeWords(place), contactId: sender.contactId };
  if (savesThread(found, sent.chatId)) await repo.saveThread(t, { ...key, ...started });
  const use = {
    companyId: t.companyId,
    agentId: agent.id,
    chatId: sent.chatId,
    principalId: agent.principalId,
  };
  await deps.credentials.recordSlackUse(conn.credentialId, conn.ownerUserId, { purpose: 'inbound', ...use });
  await integrationsRepo.audit(t, {
    actorKind: 'system',
    requestId: sent.turnId,
    entityType: 'slack_message',
    entityId: `${message.channel}/${message.ts}`,
    action: 'slack_inbound',
    changes: [
      { field: 'from', old: null, new: `${from} (${message.user})` },
      { field: 'place', old: null, new: placeWords(place) },
      { field: 'agent', old: null, new: agent.name },
      { field: 'chat', old: null, new: sent.chatId },
      { field: 'text', old: null, new: excerpt(text) },
    ],
  });
}

/** Handles one message (see above); Slack's and the database's failures are the caller's to log. */
export async function handleMessage(
  deps: HandleDeps,
  conn: Connection,
  message: SlackInboundMessage,
): Promise<void> {
  const what = inboundKind(message, conn.bot);
  if ('ignored' in what || conn.seen(messageKey(message))) return;
  const settings = await repo.connectionOf(owned(deps.db, conn.ownerUserId), conn.credentialId);
  if (settings === undefined || !settings.inbound) return;
  const people = peopleOf(settings);
  if (!mayWake({ wake: settings.wake, people }, message.user as string)) {
    deps.logger.info(
      { credentialId: conn.credentialId },
      'slack inbound: a message from someone not allowed',
    );
    return;
  }
  const where = { channel: message.channel, threadTs: threadRoot(message) };
  const joined = joinedRoot(message, conn.bot.url);
  const picked = await pickAgent(deps, conn, settings, message, { kind: what.kind, joined });
  if ('none' in picked) {
    if (picked.none === 'no_default')
      await notice(deps, conn, { key: 'no_default', ...where }, NO_DEFAULT_AGENT);
    return;
  }
  const place = await placeOf(deps, conn, message);
  const reach = await reachOf(conn, picked, place);
  if (reach === 'ignore') return;
  if (reach === 'refuse') {
    const key = `refuse:${picked.agent.id}:${place.id}`;
    return notice(deps, conn, { key, ...where }, notAllowedWords(picked.agent.name, place));
  }
  if (await overCap(deps, conn, settings)) {
    return notice(deps, conn, { key: 'cap', ...where }, capWords(settings.maxPerHour));
  }
  await wake(deps, conn, { settings, people, message, picked, place, joined });
}
