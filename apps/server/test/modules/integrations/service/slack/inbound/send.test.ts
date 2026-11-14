import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatTurnView } from '../../../../../../src/modules/chats/schemas.ts';
import { addToChat } from '../../../../../fixtures/chats/people.ts';
import { chatPath, endTurn, eventually, turnRow, usesOf } from '../../../../../fixtures/chats/world.ts';
import { CHAT_GENERAL, putSlackPart } from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  GENERAL,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  ok,
  postRows,
  postsOf,
  slackError,
  threadRows,
} from '../../../../../fixtures/integrations/slack-inbound.ts';
import { addMember, as } from '../../../../../fixtures/members/members.ts';

/**
 * Send in Slack (2026-11-14, docs/subscriptions.md "Send in Slack"): in a Slack conversation's chat, its Slack
 * connection's owner posts straight into that conversation as the bot, with no agent turn; the thread keeps it as their
 * message (a `slack` turn with its link), the post is recorded with the chat (a reply comes back to it) and audited.
 * Only the owner; the agent's profile's Slack rights and channels hold; Slack's refusals are said in words.
 */

let w: InboundWorld;
beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(() => {
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const runnerOf = (s: InboundScene) => s.runner as FakeRunner;
const error = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

/** A fresh mention answered, so its thread has a chat; the chat and the mention. */
async function slackChat(s: InboundScene, fields: Parameters<typeof message>[0] = {}) {
  const first = message(fields);
  await s.conn.deliver(first);
  const start = await runnerOf(s).frames.next('turn.start');
  answerTurn(runnerOf(s), start, 'Here.');
  await eventually('the answer posted', () => postsOf(w).length >= 1);
  const rows = await threadRows(w.t.db);
  const chatId = rows.filter((row) => row.companyId === s.company.companyId).at(-1)?.chatId as string;
  return { chatId, first };
}

const send = (s: InboundScene, chatId: string, text: string, person = s.company.owner) =>
  as(w, person)('POST', chatPath(s.company, chatId, '/slack-messages'), { text });

describe('POST chats/:chatId/slack-messages', () => {
  it('posts into the thread as the bot, with no agent turn, kept as the owner’s message with its link', async () => {
    const s = await inboundScene(w);
    const { chatId, first } = await slackChat(s);
    const detail = (await as(w, s.company.owner)('GET', chatPath(s.company, chatId))).body as ChatDetailView;
    expect(detail.slack).toEqual({
      place: '#general',
      link: `https://airia-fake.slack.com/archives/${GENERAL}/p${first.ts.replace('.', '')}`,
      mayPost: true,
    });
    expect(detail.people.map((p) => p.kind)).toEqual(['member', 'contact']);
    answerSlack(w, { 'chat.postMessage': ok({ channel: GENERAL, ts: '1731500000.000200' }) });
    const turns = runnerOf(s).frames.of('turn.start').length;
    const res = await send(s, chatId, 'On it, Erich');
    const turn = res.body as ChatTurnView;
    expect([res.status, turn.kind, turn.status, turn.prompt, turn.createdBy]).toEqual([
      201,
      'slack',
      'done',
      'On it, Erich',
      s.company.owner.principalId,
    ]);
    expect(turn.replyLink).toBe(
      `https://airia-fake.slack.com/archives/${GENERAL}/p1731500000000200?thread_ts=${first.ts}&cid=${GENERAL}`,
    );
    const post = postsOf(w).at(-1);
    expect(post).toMatchObject({ channel: GENERAL, thread_ts: first.ts, text: 'On it, Erich' });
    expect(post?.username).toBeUndefined();
    expect(runnerOf(s).frames.of('turn.start')).toHaveLength(turns);
    expect((await postRows(w.t.db)).at(-1)).toMatchObject({
      chatId,
      turnId: null,
      agentId: s.agentId,
      ts: '1731500000.000200',
      threadTs: first.ts,
    });
    const uses = await usesOf(w.t.db, s.signIn.id);
    expect(uses.at(-1)).toMatchObject({
      purpose: 'chat_send',
      chatId,
      principalId: s.company.owner.principalId,
    });
    const audit = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'slack_send'), eq(auditLog.entityId, `${GENERAL}/1731500000.000200`)));
    expect(audit.map((row) => [row.actorPrincipalId, row.field])).toContainEqual([
      s.company.owner.principalId,
      'text',
    ]);
    // A reply in the thread goes on in the same chat.
    await s.conn.deliver(message({ type: 'message', text: 'thanks', threadTs: first.ts }));
    const next = await runnerOf(s).frames.next('turn.start');
    expect((await turnRow(w.t.db, next.turnId))?.chatId).toBe(chatId);
    endTurn(runnerOf(s), next.turnId);
  });

  it("is only the Slack connection's owner's, in a Slack conversation's chat", async () => {
    const s = await inboundScene(w);
    const { chatId } = await slackChat(s);
    const admin = await addMember(w, s.company, 'admin');
    expect(error(await send(s, chatId, 'hi', admin))).toEqual([404, 'chat_not_found']);
    await addToChat(w, s.company, chatId, [admin]);
    const theirs = (await as(w, admin)('GET', chatPath(s.company, chatId))).body as ChatDetailView;
    expect(theirs.slack?.mayPost).toBe(false);
    expect(error(await send(s, chatId, 'hi', admin))).toEqual([403, 'not_slack_owner']);
    expect(error(await send(s, s.chat.id, 'hi'))).toEqual([409, 'not_slack_chat']);
    expect((await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id))).body).toMatchObject({
      slack: null,
    });
  });

  it("holds the agent's Slack rights and says why the bot cannot post", async () => {
    const s = await inboundScene(w);
    const { chatId } = await slackChat(s);
    await putSlackPart(w.t.db, s.profile.id, {
      credentialId: s.signIn.id,
      rights: { ...CHAT_GENERAL, post: false },
    });
    const off = await send(s, chatId, 'hi');
    expect(error(off)).toEqual([409, 'slack_refused']);
    expect((off.body as { error: { message: string } }).error.message).toContain('Posting in Slack is off');
    await putSlackPart(w.t.db, s.profile.id, {
      credentialId: s.signIn.id,
      rights: { ...CHAT_GENERAL, channels: ['random'] },
    });
    expect((await send(s, chatId, 'hi')).body).toMatchObject({ error: { code: 'slack_refused' } });
    await putSlackPart(w.t.db, s.profile.id, { credentialId: null, rights: CHAT_GENERAL });
    expect((await send(s, chatId, 'hi')).body).toMatchObject({ error: { code: 'slack_refused' } });
    await putSlackPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: CHAT_GENERAL });
    answerSlack(w, { 'chat.postMessage': slackError('not_in_channel') });
    const out = await send(s, chatId, 'hi');
    expect(error(out)).toEqual([409, 'slack_refused']);
    expect((out.body as { error: { message: string } }).error.message).toContain('invite the bot');
    answerSlack(w, { 'chat.postMessage': slackError('service_unavailable') });
    expect(error(await send(s, chatId, 'hi'))[0]).toBeGreaterThanOrEqual(409);
    expect((await postRows(w.t.db)).filter((row) => row.chatId === chatId && row.turnId === null)).toEqual(
      [],
    );
  });
});

describe('a Send in Slack in a DM’s conversation', () => {
  it('goes into the thread of the DM’s message, where a reply goes on in the same chat; a new DM message starts another', async () => {
    const s = await inboundScene(w, { rights: { dms: 'post' } });
    const dm = { type: 'message' as const, channel: 'D0DM9', channelType: 'im' };
    const { chatId, first } = await slackChat(s, { ...dm, text: 'hello' });
    answerSlack(w, { 'chat.postMessage': ok({ channel: 'D0DM9', ts: '1731500100.000100' }) });
    expect((await send(s, chatId, 'Did it work?')).status).toBe(201);
    expect(postsOf(w).at(-1)).toMatchObject({ channel: 'D0DM9', thread_ts: first.ts, text: 'Did it work?' });
    await s.conn.deliver(message({ ...dm, text: 'yes it did', threadTs: first.ts }));
    const back = await runnerOf(s).frames.next('turn.start');
    expect((await turnRow(w.t.db, back.turnId))?.chatId).toBe(chatId);
    endTurn(runnerOf(s), back.turnId);
    await s.conn.deliver(message({ ...dm, text: 'something else' }));
    const next = await runnerOf(s).frames.next('turn.start');
    expect((await turnRow(w.t.db, next.turnId))?.chatId).not.toBe(chatId);
    endTurn(runnerOf(s), next.turnId);
  });
});
