import { agents, slackPosts } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eventually } from '../../../../../fixtures/chats/world.ts';
import {
  answerSlack,
  answerTurn,
  BOT,
  callsOf,
  GENERAL,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  ok,
  otherAgent,
  postsOf,
  putInbound,
  threadRows,
} from '../../../../../fixtures/integrations/slack-inbound.ts';

/**
 * Who answers a Slack message (2026-11-13): an agent named right after the bot's mention (`@Bot @Developer …`); for a
 * reply in a thread, the agent that last posted there (its recorded post, else the agent whose name the bot posted the
 * thread's first message under); else the default agent; a reply in a thread no agent of ours is in is left alone, and
 * a fresh mention with no default agent says so once.
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

/** The agent whose chat the turn the runner got is in. */
async function answeredBy(s: InboundScene): Promise<string> {
  const start = await (s.runner as FakeRunner).frames.next('turn.start');
  const [thread] = (await threadRows(w.t.db))
    .filter((row) => row.companyId === s.company.companyId)
    .slice(-1);
  const before = postsOf(w).length;
  answerTurn(s.runner as FakeRunner, start, 'Here.');
  await eventually('the answer is posted', () => postsOf(w).length > before);
  return thread?.agentId as string;
}

/** Records a post of the agent's in #general, as its tools would. */
async function recordPost(s: InboundScene, agentId: string, ts: string, threadTs: string | null = null) {
  await rawDb(w.t.db).insert(slackPosts).values({
    ownerUserId: s.company.owner.userId,
    credentialId: s.signIn.id,
    channelId: GENERAL,
    ts,
    threadTs,
    companyId: s.company.companyId,
    agentId,
  });
}

describe('an agent named after the bot', () => {
  it('answers `@Bot @Developer …` in any case, the default agent otherwise', async () => {
    const s = await inboundScene(w);
    const developer = await otherAgent(w, s, 'Developer', true);
    await s.conn.deliver(message({ text: `<@${BOT}> @developer hi` }));
    expect(await answeredBy(s)).toBe(developer.id);
    await s.conn.deliver(message({ text: `<@${BOT}> @Nobody hi` }));
    expect(await answeredBy(s)).toBe(s.agentId);
  });

  it('says once that a named agent without a Slack part on this bot may not post there', async () => {
    const s = await inboundScene(w);
    await otherAgent(w, s, 'Developer', false);
    await s.conn.deliver(message({ text: `<@${BOT}> @Developer hi` }));
    await s.conn.deliver(message({ text: `<@${BOT}> @Developer again` }));
    expect(postsOf(w).map((post) => post.text)).toEqual(["Developer isn't allowed to post in #general."]);
    expect(await threadRows(w.t.db)).not.toContainEqual(
      expect.objectContaining({ companyId: s.company.companyId }),
    );
  });
});

describe('a reply in a thread', () => {
  it('goes to the agent that posted there, by its recorded post', async () => {
    const s = await inboundScene(w);
    const qa = await otherAgent(w, s, 'QA', true);
    await recordPost(s, qa.id, '1731400000.000100');
    const reply = message({
      type: 'message',
      text: 'Thx brother! Tell me a joke',
      threadTs: '1731400000.000100',
    });
    await s.conn.deliver(reply);
    expect(await answeredBy(s)).toBe(qa.id);
    expect(postsOf(w).at(-1)).toMatchObject({ thread_ts: '1731400000.000100', username: 'QA' });
  });

  it('goes to the agent whose name the bot posted the thread’s first message under, when it was not recorded', async () => {
    const s = await inboundScene(w);
    const first = { ts: '1731300000.000100', bot_id: 'B0BOT', username: s.agentName, text: 'Done.' };
    answerSlack(w, { 'conversations.replies': ok({ messages: [first] }) });
    await s.conn.deliver(message({ type: 'message', text: 'Thanks!', threadTs: first.ts }));
    expect(await answeredBy(s)).toBe(s.agentId);
    expect(callsOf(w, 'conversations.replies')).toHaveLength(1);
  });

  it('is left alone in a thread no agent of ours is in', async () => {
    const s = await inboundScene(w);
    const theirs = { ts: '1731200000.000100', user: 'U0SOMEONE', text: 'Lunch?' };
    answerSlack(w, { 'conversations.replies': ok({ messages: [theirs] }) });
    await s.conn.deliver(message({ type: 'message', text: 'Sure', threadTs: theirs.ts }));
    expect(postsOf(w)).toEqual([]);
    expect(callsOf(w, 'reactions.add')).toEqual([]);
  });

  it('with a mention, goes to the default agent in a thread no agent of ours is in', async () => {
    const s = await inboundScene(w);
    const theirs = { ts: '1731100000.000100', user: 'U0SOMEONE', text: 'Lunch?' };
    answerSlack(w, { 'conversations.replies': ok({ messages: [theirs] }) });
    await s.conn.deliver(message({ text: `<@${BOT}> what do you think?`, threadTs: theirs.ts }));
    expect(await answeredBy(s)).toBe(s.agentId);
    expect(postsOf(w).at(-1)).toMatchObject({ thread_ts: theirs.ts });
  });

  it('goes to the default agent when its last poster was archived meanwhile', async () => {
    const s = await inboundScene(w);
    const gone = await otherAgent(w, s, 'Gone', true);
    await recordPost(s, gone.id, '1731000000.000100');
    await rawDb(w.t.db).update(agents).set({ status: 'archived' }).where(eq(agents.id, gone.id));
    await s.conn.deliver(message({ text: `<@${BOT}> still there?`, threadTs: '1731000000.000100' }));
    expect(await answeredBy(s)).toBe(s.agentId);
  });
});

describe('the default agent', () => {
  it('answers a DM', async () => {
    const s = await inboundScene(w, { rights: { dms: 'post' } });
    await s.conn.deliver(message({ type: 'message', channel: 'D0DM1', channelType: 'im', text: 'hey' }));
    expect(await answeredBy(s)).toBe(s.agentId);
    expect(postsOf(w).at(-1)).toMatchObject({ channel: 'D0DM1' });
    expect(postsOf(w).at(-1)?.thread_ts).toBeUndefined();
  });

  it('when there is none, a fresh mention says so once', async () => {
    const s = await inboundScene(w);
    expect((await putInbound(w, s, { defaultAgent: null })).status).toBe(200);
    await s.conn.deliver(message());
    await s.conn.deliver(message());
    expect(postsOf(w).map((post) => post.text)).toEqual([
      'No agent answers here yet: choose a default agent on this Slack sign-in’s card in Most Wanted (Subscriptions → Tools).',
    ]);
  });
});
