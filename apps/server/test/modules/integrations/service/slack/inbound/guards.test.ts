import { chats, chatTurns } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { endTurn, eventually, place } from '../../../../../fixtures/chats/world.ts';
import { SLACK_BOT_SCOPES, setScopes } from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  BOT,
  callsOf,
  GENERAL,
  IHOR,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  ok,
  postsOf,
  putInbound,
  rawChannel,
  slackError,
} from '../../../../../fixtures/integrations/slack-inbound.ts';
import {
  boxDriver,
  connectController,
  eventsOf,
  macAndBox,
  putPolicy,
} from '../../../../../fixtures/machines/power.ts';
import { auditTrail } from '../../../../../fixtures/org.ts';

/**
 * The guards of receiving Slack messages (2026-11-13): who may wake agents (only the people listed, or anyone); never
 * the bot's own messages, other bots', edits or other subtypes, nor a channel message that is no mention or thread reply;
 * a mention Slack sends twice wakes once; the agent's profile's channels and DMs (outside them ignored, without the
 * right to post said once); the hourly cap (said once, then silence until the hour is over); a stopped machine started
 * only when its policy starts it for a message; 👀 only with reactions:write; each wake audited.
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

/** The turns Most Wanted queued in the scene's company. */
const systemTurns = async (s: InboundScene) =>
  (await rawDb(w.t.db).select().from(chatTurns).where(eq(chatTurns.companyId, s.company.companyId))).filter(
    (turn) => turn.system,
  ).length;

/** Delivers a message and says whether it woke the agent (a turn), ending the turn its runner got. */
async function woke(s: InboundScene, fields: Parameters<typeof message>[0] = {}): Promise<boolean> {
  const before = await systemTurns(s);
  await s.conn.deliver(message(fields));
  if ((await systemTurns(s)) === before) return false;
  const start = await runnerOf(s).frames.next('turn.start');
  endTurn(runnerOf(s), start.turnId);
  await eventually(
    'the turn ended',
    async () =>
      (await rawDb(w.t.db).select().from(chatTurns).where(eq(chatTurns.id, start.turnId)))[0]?.endedAt !=
      null,
  );
  return true;
}

describe('who may wake agents', () => {
  it('only the people listed, by default; anyone once the connection says so', async () => {
    const s = await inboundScene(w);
    expect(await woke(s, { user: 'U0STRANGER' })).toBe(false);
    expect(postsOf(w)).toEqual([]);
    expect(w.logs.some((line) => line.msg === 'slack inbound: a message from someone not allowed')).toBe(
      true,
    );
    expect(await woke(s, { user: IHOR })).toBe(true);
    expect((await putInbound(w, s, { wake: 'anyone' })).status).toBe(200);
    expect(await woke(s, { user: 'U0STRANGER' })).toBe(true);
  });

  it('nobody, while none is listed', async () => {
    const s = await inboundScene(w, { settings: { people: [] } });
    expect(await woke(s)).toBe(false);
  });
});

describe('what never wakes an agent', () => {
  it('the bot’s own messages, other bots’, edits, other subtypes and plain channel messages', async () => {
    const s = await inboundScene(w, { settings: { wake: 'anyone' } });
    expect(await woke(s, { botId: 'B0BOT', user: BOT, subtype: 'bot_message' })).toBe(false);
    expect(await woke(s, { user: BOT })).toBe(false);
    expect(await woke(s, { botId: 'B0OTHER', user: 'U0CIBOT' })).toBe(false);
    expect(await woke(s, { edited: true })).toBe(false);
    expect(await woke(s, { subtype: 'message_changed' })).toBe(false);
    expect(await woke(s, { subtype: 'channel_join' })).toBe(false);
    expect(await woke(s, { user: null })).toBe(false);
    expect(await woke(s, { type: 'message', text: 'just chatting' })).toBe(false);
    expect(callsOf(w, 'reactions.add')).toEqual([]);
    expect(postsOf(w)).toEqual([]);
  });

  it('a mention Slack sent twice (app_mention and message) a second time', async () => {
    const s = await inboundScene(w);
    const mention = message();
    await s.conn.deliver(mention);
    await s.conn.deliver({ ...mention, type: 'message', eventId: 'EvOther' });
    expect(await systemTurns(s)).toBe(1);
    endTurn(runnerOf(s), (await runnerOf(s).frames.next('turn.start')).turnId);
  });

  it('a message once receiving is off', async () => {
    const s = await inboundScene(w);
    expect((await putInbound(w, s, { inbound: false })).status).toBe(200);
    expect(await woke(s)).toBe(false);
  });
});

describe('the agent’s profile', () => {
  it('ignores channels outside its Slack channels, and says once where it may not post', async () => {
    const s = await inboundScene(w, { rights: { post: false } });
    answerSlack(w, { 'conversations.info': ok({ channel: rawChannel('C0RANDOM1', 'random') }) });
    expect(await woke(s, { channel: 'C0RANDOM1' })).toBe(false);
    expect(postsOf(w)).toEqual([]);
    answerSlack(w, { 'conversations.info': ok({ channel: rawChannel(GENERAL, 'general') }) });
    expect(await woke(s)).toBe(false);
    expect(await woke(s)).toBe(false);
    expect(postsOf(w).map((post) => post.text)).toEqual([
      `${s.agentName} isn't allowed to post in #general.`,
    ]);
  });

  it('ignores DMs while its DMs are off, and says once that it may only read them', async () => {
    const dm = { type: 'message' as const, channel: 'D0DM3', channelType: 'im', text: 'hi' };
    const off = await inboundScene(w);
    expect(await woke(off, dm)).toBe(false);
    expect(postsOf(w)).toEqual([]);
    const read = await inboundScene(w, { rights: { dms: 'read' } });
    expect(await woke(read, dm)).toBe(false);
    expect(postsOf(w).map((post) => post.text)).toEqual([
      `${read.agentName} isn't allowed to post in direct messages.`,
    ]);
  });

  it('adds 👀 only when the bot may react', async () => {
    const s = await inboundScene(w);
    expect(await woke(s)).toBe(true);
    expect(callsOf(w, 'reactions.add')).toHaveLength(1);
    await setScopes(
      w.t.db,
      s.signIn.id,
      SLACK_BOT_SCOPES.filter((scope) => scope !== 'reactions:write'),
    );
    expect((await putInbound(w, s, { appToken: 'xapp-1-A0FAKE-1234567890-ANOTHERappTOKEN' })).status).toBe(
      200,
    );
    const fresh = { ...s, conn: w.sockets.latest() };
    expect(await woke(fresh)).toBe(true);
    expect(callsOf(w, 'reactions.add')).toHaveLength(1);
  });
});

describe('Slack refusing', () => {
  it('its reads and the reaction still wakes the agent, by the names and ids it has; a notice it refuses is logged', async () => {
    const s = await inboundScene(w, { rights: { channels: 'all' } });
    answerSlack(w, {
      'conversations.info': slackError('channel_not_found'),
      'users.info': slackError('user_not_found'),
      'reactions.add': slackError('already_reacted'),
    });
    await s.conn.deliver(message());
    const start = await runnerOf(s).frames.next('turn.start');
    expect(start.spec.prompt.split('\n')[0]).toContain(`Slack message from Ihor Herasko in #${GENERAL} (`);
    endTurn(runnerOf(s), start.turnId);
    expect(w.logs.map((line) => line.msg)).toEqual(
      expect.arrayContaining([
        'slack inbound: could not read a conversation',
        'slack inbound: could not read a person',
        'slack inbound: could not react to a message',
      ]),
    );
    const named = await inboundScene(w, { rights: { post: false } });
    answerSlack(w, { 'chat.postMessage': slackError('not_in_channel') });
    expect(await woke(named)).toBe(false);
    expect(w.logs.some((line) => line.msg === 'slack inbound: could not post a notice')).toBe(true);
  });
});

describe('the hourly cap', () => {
  it('says so once, then is silent until the hour is over', async () => {
    const s = await inboundScene(w, { settings: { maxPerHour: 1 } });
    expect(await woke(s)).toBe(true);
    expect(await woke(s)).toBe(false);
    expect(await woke(s)).toBe(false);
    expect(postsOf(w).map((post) => post.text)).toEqual([
      'This Slack connection is at its 1 answers an hour: agents answer here again within the hour.',
    ]);
    w.clock.advance(60 * 60_000 + 1);
    expect(await woke(s)).toBe(true);
  });
});

describe('a stopped machine', () => {
  it('is started only when its policy starts it for a message', async () => {
    const s = await inboundScene(w);
    const { mac, box } = await macAndBox(w, s.company);
    await connectController(w, mac.runnerKey, boxDriver());
    await putPolicy(w, s.company, box.machineId, { autoStartOnWork: true, autoStartOnMessage: false });
    await place(w, s.company, s.agentId, { machineId: box.machineId });
    await s.conn.deliver(message());
    expect(postsOf(w).map((post) => post.text)).toEqual([
      expect.stringMatching(/^Couldn't answer: .* is stopped$/),
    ]);
    await putPolicy(w, s.company, box.machineId, { autoStartOnWork: true, autoStartOnMessage: true });
    await s.conn.deliver(message());
    const onBox = await rawDb(w.t.db).select().from(chats).where(eq(chats.machineId, box.machineId));
    const turns = await rawDb(w.t.db)
      .select()
      .from(chatTurns)
      .where(
        inArray(
          chatTurns.chatId,
          onBox.map((chat) => chat.id),
        ),
      );
    expect(turns).toEqual([
      expect.objectContaining({ status: 'queued', machineWait: 'stopped', system: true }),
    ]);
    await eventually('the start is logged', async () =>
      (await eventsOf(w.t.db, box.machineId)).some((line) =>
        line.includes('Started for a Slack message from'),
      ),
    );
  });
});

describe('the records', () => {
  it('audit each wake by the system and each answer by the agent, on the message', async () => {
    const s = await inboundScene(w);
    const mention = message();
    await s.conn.deliver(mention);
    const start = await runnerOf(s).frames.next('turn.start');
    answerTurn(runnerOf(s), start, 'Here.');
    await eventually('the answer is posted', () => postsOf(w).length === 1);
    const wake = await auditTrail(w.t.db, 'slack_message', `${GENERAL}/${mention.ts}`);
    expect(wake.map(([action, field]) => `${action} ${field}`)).toEqual([
      'slack_inbound from',
      'slack_inbound place',
      'slack_inbound agent',
      'slack_inbound chat',
      'slack_inbound text',
    ]);
    expect(wake[0]?.[3]).toBe(`Ihor Herasko (${IHOR})`);
    const answer = await auditTrail(w.t.db, 'slack_message', `${GENERAL}/1731499999.000100`);
    expect(answer.map(([action, field]) => `${action} ${field}`)).toEqual(
      expect.arrayContaining(['slack_reply place', 'slack_reply thread', 'slack_reply text']),
    );
  });
});
