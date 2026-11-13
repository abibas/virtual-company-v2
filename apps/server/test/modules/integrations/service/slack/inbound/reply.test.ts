import { agents, chats } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  agentChatsPath,
  chatPath,
  chatRow,
  ended,
  endTurn,
  eventually,
  turnRow,
  usesOf,
} from '../../../../../fixtures/chats/world.ts';
import { callTool } from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  GENERAL,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  postRows,
  postsOf,
  slackError,
  threadRows,
} from '../../../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../../../fixtures/members/members.ts';
import { revokeSubscription } from '../../../../../fixtures/org.ts';

/**
 * A Slack message's turn and its answer (2026-11-13): a fresh mention wakes the default agent in a chat of its own for
 * that thread ("Slack · #general · …", in its chat list), with 👀 first and a prompt of the message with a header; the
 * final reply is posted in the thread under the agent's name and recorded, so the next reply there goes on in the same
 * chat. An agent that posted there itself is not posted for twice; a turn that fails, or cannot start, says why; a stop
 * says nothing; a DM is one conversation; a chat that cannot go on is replaced.
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
const chatOf = async (s: InboundScene) =>
  (await threadRows(w.t.db)).filter((row) => row.companyId === s.company.companyId).at(-1)?.chatId as string;

/** Waits until the server posted `count` messages in this test. */
const posted = (count: number) => eventually(`${count} posts`, () => postsOf(w).length >= count);

describe('a fresh mention', () => {
  it('wakes the default agent in its own chat for the thread and posts its answer there under its name', async () => {
    const s = await inboundScene(w);
    const first = message();
    await s.conn.deliver(first);
    const start = await runnerOf(s).frames.next('turn.start');
    expect(start.spec.prompt).toBe(
      `Slack message from Ihor Herasko in #general (https://airia-fake.slack.com/archives/${GENERAL}/p${first.ts.replace('.', '')}). ` +
        'Your final reply is posted in that thread under your name.\n\n@mw-bot Bro are you there?',
    );
    const [thread] = await threadRows(w.t.db);
    expect(thread).toMatchObject({
      channelId: GENERAL,
      threadTs: first.ts,
      place: '#general',
      agentId: s.agentId,
    });
    expect(await chatRow(w.t.db, thread?.chatId as string)).toMatchObject({
      title: 'Slack · #general · Bro are you there?',
    });
    const list = await as(w, s.company.owner)('GET', agentChatsPath(s.company, s.agentId));
    expect(JSON.stringify(list.body)).toContain('Slack · #general · Bro are you there?');
    answerTurn(runnerOf(s), start, 'Yes bro, here.');
    await ended(w.t.db, start.turnId);
    await posted(1);
    expect(postsOf(w)[0]).toMatchObject({
      channel: GENERAL,
      thread_ts: first.ts,
      text: 'Yes bro, here.',
      username: s.agentName,
    });
    expect((await postRows(w.t.db)).at(-1)).toMatchObject({ threadTs: first.ts, agentId: s.agentId });
    expect((await usesOf(w.t.db, s.signIn.id)).map((use) => use.purpose)).toEqual(
      expect.arrayContaining(['socket_mode', 'inbound', 'inbound_reply']),
    );
  });

  it('goes on in the same chat for the next reply in its thread, which resumes the conversation', async () => {
    const s = await inboundScene(w);
    const first = message();
    await s.conn.deliver(first);
    const start = await runnerOf(s).frames.next('turn.start');
    answerTurn(runnerOf(s), start, 'Here.');
    await posted(1);
    await s.conn.deliver(
      message({ type: 'message', text: 'Thx brother! Tell me a joke', threadTs: first.ts }),
    );
    const next = await runnerOf(s).frames.next('turn.start');
    expect(next.spec.sessionId).toBe(`session-${start.turnId.slice(0, 8)}`);
    expect((await turnRow(w.t.db, next.turnId))?.chatId).toBe(await chatOf(s));
    expect(next.spec.prompt).toContain('Thx brother! Tell me a joke');
    endTurn(runnerOf(s), next.turnId);
  });
});

describe('the answer', () => {
  it('is not posted again when the agent replied in the thread itself during the turn', async () => {
    const s = await inboundScene(w);
    const first = message();
    await s.conn.deliver(first);
    const start = await runnerOf(s).frames.next('turn.start');
    const reply = await callTool(s, start, 'slack_reply_to_thread', {
      channel_id: GENERAL,
      thread_ts: first.ts,
      text: 'Why did the bot cross the road?',
    });
    expect(reply.ok).toBe(true);
    answerTurn(runnerOf(s), start, 'I told a joke in the thread.');
    await ended(w.t.db, start.turnId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postsOf(w).map((post) => post.text)).toEqual(['Why did the bot cross the road?']);
  });

  it('says why when the turn failed, and nothing when it was stopped', async () => {
    const s = await inboundScene(w);
    await s.conn.deliver(message());
    const start = await runnerOf(s).frames.next('turn.start');
    endTurn(runnerOf(s), start.turnId, { ok: false, exitCode: 1, error: 'claude exited 1' });
    await posted(1);
    expect(postsOf(w)[0]?.text).toBe("Couldn't answer: claude exited 1");
    await s.conn.deliver(message());
    const second = await runnerOf(s).frames.next('turn.start');
    const chatId = (await turnRow(w.t.db, second.turnId))?.chatId as string;
    await as(w, s.company.owner)('POST', chatPath(s.company, chatId, `/turns/${second.turnId}/stop`));
    endTurn(runnerOf(s), second.turnId, { ok: false, exitCode: 143 });
    expect((await ended(w.t.db, second.turnId))?.status).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postsOf(w)).toHaveLength(1);
  });

  it('says why a turn could not start: a paused agent', async () => {
    const s = await inboundScene(w);
    await rawDb(w.t.db).update(agents).set({ status: 'paused' }).where(eq(agents.id, s.agentId));
    await s.conn.deliver(message());
    expect(postsOf(w).map((post) => post.text)).toEqual(["Couldn't answer: The agent is paused"]);
  });

  it('says why a message that waited behind a turn could not start', async () => {
    const s = await inboundScene(w);
    const first = message();
    await s.conn.deliver(first);
    const start = await runnerOf(s).frames.next('turn.start');
    await s.conn.deliver(message({ type: 'message', text: 'and another', threadTs: first.ts }));
    await rawDb(w.t.db).update(agents).set({ profileId: null }).where(eq(agents.id, s.agentId));
    answerTurn(runnerOf(s), start, 'One.');
    await posted(2);
    expect(postsOf(w).map((post) => post.text)).toEqual([
      'One.',
      expect.stringMatching(/^Couldn't answer: /),
    ]);
  });
});

describe('an answer that cannot be posted', () => {
  it('is logged: a sign-in revoked meanwhile, or Slack refusing the post', async () => {
    const s = await inboundScene(w);
    await s.conn.deliver(message());
    const start = await runnerOf(s).frames.next('turn.start');
    await revokeSubscription(w.t.db, s.signIn.id);
    answerTurn(runnerOf(s), start, 'Here.');
    await ended(w.t.db, start.turnId);
    await eventually('the refusal is logged', () =>
      w.logs.some((line) => String(line.msg).startsWith('slack inbound: no answer posted:')),
    );
    const other = await inboundScene(w);
    await other.conn.deliver(message());
    const next = await runnerOf(other).frames.next('turn.start');
    answerSlack(w, { 'chat.postMessage': slackError('not_in_channel') });
    answerTurn(runnerOf(other), next, 'Here.');
    await eventually('the refusal is logged', () =>
      w.logs.some((line) => line.msg === 'slack inbound: the answer was not posted'),
    );
    expect(postsOf(w).map((post) => post.text)).toEqual(['Here.']);
  });
});

describe('the conversation', () => {
  it('is the DM itself for a DM’s messages in no thread, answered there', async () => {
    const s = await inboundScene(w, { rights: { dms: 'post' } });
    const dm = { type: 'message' as const, channel: 'D0DM2', channelType: 'im' };
    await s.conn.deliver(message({ ...dm, text: 'hello' }));
    const start = await runnerOf(s).frames.next('turn.start');
    answerTurn(runnerOf(s), start, 'Hi.');
    await posted(1);
    await s.conn.deliver(message({ ...dm, text: 'again' }));
    const next = await runnerOf(s).frames.next('turn.start');
    expect((await turnRow(w.t.db, next.turnId))?.chatId).toBe(await chatOf(s));
    expect(await threadRows(w.t.db)).toContainEqual(
      expect.objectContaining({ channelId: 'D0DM2', threadTs: null }),
    );
    expect(next.spec.prompt.split('\n')[0]).toContain('in a DM with you');
    endTurn(runnerOf(s), next.turnId);
  });

  it('gets a new chat when its chat was archived', async () => {
    const s = await inboundScene(w);
    const first = message();
    await s.conn.deliver(first);
    const start = await runnerOf(s).frames.next('turn.start');
    answerTurn(runnerOf(s), start, 'Here.');
    await posted(1);
    const old = await chatOf(s);
    await rawDb(w.t.db).update(chats).set({ archivedAt: new Date() }).where(eq(chats.id, old));
    await s.conn.deliver(message({ type: 'message', text: 'still?', threadTs: first.ts }));
    const next = await runnerOf(s).frames.next('turn.start');
    const fresh = await chatOf(s);
    expect(fresh).not.toBe(old);
    expect((await turnRow(w.t.db, next.turnId))?.chatId).toBe(fresh);
    endTurn(runnerOf(s), next.turnId);
  });
});
