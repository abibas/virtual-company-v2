import { slackPosts, slackThreads } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import type { SlackInboundMessage } from '@mwc/tools-core';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatRow, eventually, turnRow } from '../../../../../fixtures/chats/world.ts';
import {
  answerTurn,
  BOT,
  GENERAL,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  postRows,
  postsGetTheirOwnTs,
  postsOf,
  threadRows,
} from '../../../../../fixtures/integrations/slack-inbound.ts';

/**
 * Which conversation a Slack message goes on in (2026-11-14, docs/subscriptions.md "One conversation per thread"): a
 * message in no thread, a channel's mention or a DM's message, starts a new chat answered in its own thread; a reply in a
 * thread, or a mention there, goes on in that thread's; a DM's conversation from before (the DM itself) goes on in the
 * thread under one of its answers; a message that links or shares a message of the same channel goes on in that
 * message's thread's conversation, answered under itself, and so does a reply under that answer.
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

const WORKSPACE = 'https://airia-fake.slack.com';
const linkTo = (channel: string, ts: string) => `${WORKSPACE}/archives/${channel}/p${ts.replace('.', '')}`;
const sessionOf = (start: TurnStart) => `session-${start.turnId.slice(0, 8)}`;

/** A scene whose posts each get a ts of their own. */
async function sceneOf(options: Parameters<typeof inboundScene>[1] = {}) {
  const s = await inboundScene(w, options);
  postsGetTheirOwnTs(w);
  return s;
}

/** Delivers the message, answers its turn and waits for the answer's post; its turn and chat. */
async function turnFor(s: InboundScene, sent: SlackInboundMessage, reply: string) {
  const runner = s.runner as FakeRunner;
  const before = postsOf(w).length;
  await s.conn.deliver(sent);
  const start = await runner.frames.next('turn.start');
  const chatId = (await turnRow(w.t.db, start.turnId))?.chatId as string;
  answerTurn(runner, start, reply);
  await eventually('the answer is posted', () => postsOf(w).length > before);
  return { start, chatId };
}

const rowsOf = async (s: InboundScene) =>
  (await threadRows(w.t.db)).filter((row) => row.companyId === s.company.companyId);

describe('a message in no thread', () => {
  it('starts a new chat each time; a reply in its thread, or a mention there, goes on in it', async () => {
    const s = await sceneOf();
    const first = message();
    const a = await turnFor(s, first, 'One.');
    const second = message({ text: `<@${BOT}> another topic` });
    const b = await turnFor(s, second, 'Two.');
    expect(b.chatId).not.toBe(a.chatId);
    expect(b.start.spec.sessionId).not.toBe(sessionOf(a.start));
    expect((await chatRow(w.t.db, b.chatId))?.title).toBe('Slack · #general · another topic');
    const reply = await turnFor(s, message({ type: 'message', text: 'more', threadTs: first.ts }), 'Three.');
    expect(reply.chatId).toBe(a.chatId);
    expect(reply.start.spec.sessionId).toBe(sessionOf(a.start));
    const mention = await turnFor(s, message({ text: `<@${BOT}> and you?`, threadTs: second.ts }), 'Four.');
    expect(mention.chatId).toBe(b.chatId);
    expect(postsOf(w).map((post) => post.thread_ts)).toEqual([first.ts, second.ts, first.ts, second.ts]);
    expect((await rowsOf(s)).map((row) => row.threadTs)).toEqual([first.ts, second.ts]);
  });
});

describe('a DM', () => {
  it('gets a new chat for each message in no thread, answered in its thread; a reply there goes on in it', async () => {
    const s = await sceneOf({ rights: { dms: 'post' } });
    const dm = { type: 'message' as const, channel: 'D0DM9', channelType: 'im' };
    const hello = message({ ...dm, text: 'hello' });
    const a = await turnFor(s, hello, 'Hi.');
    expect(a.start.spec.prompt.split('\n')[0]).toContain('in a DM with you');
    expect(a.start.spec.prompt.split('\n')[0]).toContain('Your final reply is posted in that thread');
    const question = message({ ...dm, text: 'a new question' });
    const b = await turnFor(s, question, 'Sure.');
    expect(b.chatId).not.toBe(a.chatId);
    expect((await chatRow(w.t.db, a.chatId))?.title).toBe('Slack · DM · hello');
    expect((await chatRow(w.t.db, b.chatId))?.title).toBe('Slack · DM · a new question');
    const followUp = await turnFor(s, message({ ...dm, text: 'and?', threadTs: hello.ts }), 'Yes.');
    expect(followUp.chatId).toBe(a.chatId);
    expect(followUp.start.spec.sessionId).toBe(sessionOf(a.start));
    expect(postsOf(w).map((post) => post.thread_ts)).toEqual([hello.ts, question.ts, hello.ts]);
    expect((await rowsOf(s)).map((row) => row.threadTs)).toEqual([hello.ts, question.ts]);
  });

  it('keeps a conversation from before, the DM itself, which goes on in the thread under one of its answers', async () => {
    const s = await sceneOf({ rights: { dms: 'post' } });
    const dm = { type: 'message' as const, channel: 'D0DM8', channelType: 'im' };
    const old = await turnFor(s, message({ ...dm, text: 'old times' }), 'Old answer.');
    await rawDb(w.t.db)
      .update(slackThreads)
      .set({ threadTs: null })
      .where(eq(slackThreads.chatId, old.chatId));
    await rawDb(w.t.db).update(slackPosts).set({ threadTs: null }).where(eq(slackPosts.chatId, old.chatId));
    const answer = (await postRows(w.t.db)).find((row) => row.chatId === old.chatId);
    const onIt = await turnFor(
      s,
      message({ ...dm, text: 'about that', threadTs: answer?.ts ?? null }),
      'Going on.',
    );
    expect(onIt.chatId).toBe(old.chatId);
    expect(postsOf(w).at(-1)).toMatchObject({ channel: 'D0DM8', thread_ts: answer?.ts });
    const fresh = await turnFor(s, message({ ...dm, text: 'fresh' }), 'New.');
    expect(fresh.chatId).not.toBe(old.chatId);
    const rows = await rowsOf(s);
    expect(rows.find((row) => row.chatId === old.chatId)?.threadTs).toBeNull();
    expect(rows).toHaveLength(2);
  });
});

describe('a message that points to another', () => {
  it('goes on in the conversation of the thread it links in its channel, answered under itself', async () => {
    const s = await sceneOf();
    const first = message();
    const a = await turnFor(s, first, 'One.');
    const pointing = message({ text: `<@${BOT}> about <${linkTo(GENERAL, first.ts)}>, any news?` });
    const b = await turnFor(s, pointing, 'News.');
    expect(b.chatId).toBe(a.chatId);
    expect(b.start.spec.sessionId).toBe(sessionOf(a.start));
    expect(postsOf(w).at(-1)).toMatchObject({ channel: GENERAL, thread_ts: pointing.ts });
    const thanks = await turnFor(s, message({ type: 'message', text: 'thx', threadTs: pointing.ts }), 'Np.');
    expect(thanks.chatId).toBe(a.chatId);
    expect(postsOf(w).at(-1)).toMatchObject({ thread_ts: pointing.ts });
    expect((await rowsOf(s)).map((row) => row.threadTs)).toEqual([first.ts]);
  });

  it('points by a reply’s link or a shared message too; a link to another channel starts a new chat', async () => {
    const s = await sceneOf();
    const first = message();
    const a = await turnFor(s, first, 'One.');
    const reply = `${linkTo(GENERAL, '1731400000.000200')}?thread_ts=${first.ts}&amp;cid=${GENERAL}`;
    const byReply = await turnFor(s, message({ text: `<@${BOT}> <${reply}|this>` }), 'Two.');
    expect(byReply.chatId).toBe(a.chatId);
    const shared = message({ text: `<@${BOT}> see`, shared: [linkTo(GENERAL, first.ts)] });
    expect((await turnFor(s, shared, 'Three.')).chatId).toBe(a.chatId);
    const elsewhere = message({ text: `<@${BOT}> <${linkTo('C0OTHER1', first.ts)}>` });
    const other = await turnFor(s, elsewhere, 'Four.');
    expect(other.chatId).not.toBe(a.chatId);
    expect(postsOf(w).at(-1)).toMatchObject({ thread_ts: elsewhere.ts });
  });
});
