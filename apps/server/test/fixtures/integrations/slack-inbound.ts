/**
 * Receiving Slack messages' test helpers (2026-11-13): a fake Socket Mode (`FakeSockets`: each connection the server
 * opens, through which a test delivers a message as Slack would and waits until the server handled it), a world whose
 * app keeps the connections (the fake sockets, timers fired by hand), a scene whose bot sign-in receives with its
 * settings saved through the API, a message as the connector reads one, and the runner's side of the turn it starts.
 * Never a real Slack: Socket Mode is the fake, the Web API the fake provider.
 */
import { randomUUID } from 'node:crypto';
import { type DbHandle, slackConnections, slackPosts, slackThreads } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import type {
  SlackInboundMessage,
  SlackSocket,
  SlackSocketHandlers,
  SlackSocketState,
  SlackSockets,
} from '@mwc/tools-core';
import { asc, eq } from 'drizzle-orm';
import { type ChatsWorld, chatsWorld, endTurn, place, sendEvents } from '../chats/world.ts';
import { as } from '../members/members.ts';
import { makeAgent, putProfile, seedProfile } from '../org.ts';
import { type ManualTimers, manualTimers } from '../platform/jobs.ts';
import {
  answerSlack,
  CHAT_GENERAL,
  callsOf,
  formOf,
  ok,
  principalOf,
  putSlackPart,
  rawChannel,
  type SlackScene,
  type SlackSceneOptions,
  slackError,
  slackScene,
} from './slack.ts';

export { answerSlack, callsOf, formOf, ok, rawChannel, slackError };

/** The app-level token the tests save, never shown. */
export const APP_TOKEN = 'xapp-1-A0FAKE-1234567890-APPtokenNEVERshown';
/** Ihor's Slack person (his user token's, in `TOOL_ACCOUNTS`), the bot's, and #general. */
export const IHOR = 'U0IHOR';
export const BOT = 'U0BOT';
export const GENERAL = 'C0GENERAL1';

/** One connection the server opened, as the fake Socket Mode holds it. */
export class FakeConnection implements SlackSocket {
  closed = false;
  readonly appToken: string;
  readonly #handlers: SlackSocketHandlers;

  constructor(appToken: string, handlers: SlackSocketHandlers) {
    this.appToken = appToken;
    this.#handlers = handlers;
  }

  close(): void {
    this.closed = true;
  }

  /** Slack delivers a message; resolves once the server handled it. */
  async deliver(message: SlackInboundMessage): Promise<void> {
    await this.#handlers.onMessage(message);
  }

  /** The connection's state changes, as the connector would say. */
  say(state: SlackSocketState, message: string | null = null): void {
    this.#handlers.onStatus({ state, message });
  }
}

/** The fake Socket Mode: every connection opened, the latest last. */
export class FakeSockets implements SlackSockets {
  readonly opened: FakeConnection[] = [];

  open(appToken: string, handlers: SlackSocketHandlers): SlackSocket {
    const connection = new FakeConnection(appToken, handlers);
    this.opened.push(connection);
    return connection;
  }

  latest(): FakeConnection {
    const connection = this.opened.at(-1);
    if (connection === undefined) throw new Error('no Socket Mode connection was opened');
    return connection;
  }
}

export interface InboundWorld extends ChatsWorld {
  readonly sockets: FakeSockets;
  readonly timers: ManualTimers;
}

/** The chats' world whose app keeps Slack connections on the fake Socket Mode. */
export async function inboundWorld(): Promise<InboundWorld> {
  const sockets = new FakeSockets();
  const timers = manualTimers();
  const w = await chatsWorld({}, { slackSockets: sockets, slackInboundTimers: timers.timers });
  return { ...w, sockets, timers };
}

let ts = 1731490000;

/** A message as the connector reads it: a fresh mention of the bot by Ihor in #general unless `fields` say. */
export function message(fields: Partial<SlackInboundMessage> = {}): SlackInboundMessage {
  ts += 1;
  return {
    eventId: `Ev${randomUUID().slice(0, 8)}`,
    teamId: 'T0FAKE',
    type: 'app_mention',
    channel: GENERAL,
    channelType: 'channel',
    user: IHOR,
    botId: null,
    subtype: null,
    text: `<@${BOT}> Bro are you there?`,
    ts: `${ts}.000100`,
    threadTs: null,
    edited: false,
    ...fields,
  };
}

export const inboundPath = (credentialId: string, rest = 'slack-inbound') =>
  `/api/me/subscriptions/${credentialId}/${rest}`;

/** The owner saves the sign-in's inbound settings. */
export const putInbound = (w: ChatsWorld, s: SlackScene, body: Record<string, unknown>) =>
  as(w, s.company.owner)('PUT', inboundPath(s.signIn.id), body);

export interface InboundScene extends SlackScene {
  readonly conn: FakeConnection;
}

/**
 * A Slack scene (`slackScene`: an agent whose profile's Slack part on a bot sign-in reads and posts in #general) whose
 * sign-in receives: its app token, receiving on, its agent the default, Ihor listed (or `settings`); and #general known.
 */
export async function inboundScene(
  w: InboundWorld,
  options: SlackSceneOptions & { readonly settings?: Record<string, unknown> } = {},
): Promise<InboundScene> {
  const s = await slackScene(w, options);
  const res = await putInbound(w, s, {
    appToken: APP_TOKEN,
    inbound: true,
    defaultAgent: { companyId: s.company.companyId, agentId: s.agentId },
    people: [{ id: IHOR, name: 'Ihor Herasko', image: null }],
    ...options.settings,
  });
  if (res.status !== 200)
    throw new Error(`PUT slack-inbound answered ${res.status}: ${JSON.stringify(res.body)}`);
  answerSlack(w, {
    'conversations.info': ok({ channel: rawChannel(GENERAL, 'general') }),
    'reactions.add': ok(),
    'users.info': ok({ user: { id: IHOR, name: 'ihor', real_name: 'Ihor Herasko', profile: {} } }),
    'chat.postMessage': ok({ channel: GENERAL, ts: '1731499999.000100' }),
  });
  return { ...s, conn: w.sockets.latest() };
}

/**
 * Another agent of the scene's company on its machine, on a profile of its own with the scene's subscription and, when
 * `slack`, a Slack part on the scene's bot sign-in (reading and posting in #general).
 */
export async function otherAgent(
  w: ChatsWorld,
  s: SlackScene,
  name: string,
  slack: boolean,
): Promise<{ readonly id: string; readonly principalId: string }> {
  const agent = await makeAgent(w, s.company, s.company.owner, { name });
  await place(w, s.company, agent.id, { machineId: s.machineId });
  const profile = await seedProfile(w.t.db, s.company.owner.userId, {
    provider: 'claude',
    credentialId: s.credential?.id ?? null,
    model: 'claude-opus-5-5',
    effort: 'high',
  });
  if (slack) await putSlackPart(w.t.db, profile.id, { credentialId: s.signIn.id, rights: CHAT_GENERAL });
  await putProfile(w.t.db, s.company.companyId, agent.id, profile.id);
  return { id: agent.id, principalId: await principalOf(w.t.db, agent.id) };
}

/** The runner answers a turn: its session, its reply and the end. */
export function answerTurn(runner: FakeRunner, start: TurnStart, reply: string): void {
  sendEvents(runner, start.turnId, [
    { type: 'session', sessionId: `session-${start.turnId.slice(0, 8)}` },
    { type: 'text', text: reply },
    { type: 'result', ok: true, text: reply, durationMs: 100 },
  ]);
  endTurn(runner, start.turnId);
}

/** The posts the server made (`chat.postMessage`), as their form arguments. */
export const postsOf = (w: ChatsWorld) => callsOf(w, 'chat.postMessage').map(formOf);

/** The sign-in's settings row. */
export const connectionRow = async (db: DbHandle, credentialId: string) =>
  (await rawDb(db).select().from(slackConnections).where(eq(slackConnections.credentialId, credentialId)))[0];

/** The agents' chats per Slack conversation, oldest first. */
export const threadRows = (db: DbHandle) =>
  rawDb(db).select().from(slackThreads).orderBy(asc(slackThreads.createdAt), asc(slackThreads.id));

/** The agents' recorded posts, oldest first. */
export const postRows = (db: DbHandle) => rawDb(db).select().from(slackPosts).orderBy(asc(slackPosts.id));
