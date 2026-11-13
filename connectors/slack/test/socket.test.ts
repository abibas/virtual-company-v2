import { describe, expect, it } from 'vitest';
import { isSlackSocketUrl, slackSockets } from '../src/socket.ts';
import { type Answer, fakeFetch, ok, refused } from './fixtures/fetch.ts';
import { envelope, fakeServer, handTimers, mention, recorder, settle } from './fixtures/socket.ts';

/**
 * Socket Mode's connection (2026-11-13) against a fake Socket Mode server and a fake `apps.connections.open`: the
 * address, the hello, an ack for every envelope before anything else, envelopes and events Slack sends again dropped,
 * Slack's `disconnect` (a refresh opens a new connection at once, `link_disabled` stops), the backoff after a close or a
 * missing hello, refused tokens stopping in words, and `close`.
 */

const URL_1 = 'wss://wss-primary.slack.com/link/?ticket=one&app_id=A0APP';
const URL_2 = 'wss://wss-backup.slack.com/link/?ticket=two&app_id=A0APP';
const APP_TOKEN = 'xapp-1-A0APP-FAKEappTOKEN';

function connect(answers: Answer | readonly Answer[] = ok({ url: URL_1 })) {
  const server = fakeServer();
  const hand = handTimers();
  const { fetch, calls } = fakeFetch({ 'apps.connections.open': answers });
  const told = recorder();
  const sockets = slackSockets({
    fetch,
    webSocket: server.webSocket,
    timers: hand.timers,
    backoff: { firstMs: 1_000, maxMs: 4_000 },
    helloTimeoutMs: 30_000,
  });
  const socket = sockets.open(APP_TOKEN, told.handlers);
  return { server, hand, calls, told, socket };
}

describe('opening Socket Mode', () => {
  it('asks Slack for an address with the app-level token, connects there and is connected at its hello', async () => {
    const c = connect();
    await settle();
    expect(c.calls[0]).toMatchObject({
      url: 'https://slack.com/api/apps.connections.open',
      headers: { authorization: `Bearer ${APP_TOKEN}` },
    });
    expect(c.server.latest.url).toBe(URL_1);
    expect(c.told.states()).toEqual(['connecting']);
    c.server.latest.hello();
    expect(c.told.states()).toEqual(['connecting', 'connected']);
    expect(c.hand.waits()).toEqual([]);
  });

  it('stops in words when Slack refuses the token, and tries again when Slack is away', async () => {
    const invalid = connect(refused('invalid_auth'));
    await settle();
    expect(invalid.told.statuses.at(-1)).toEqual({
      state: 'error',
      message: expect.stringContaining('refused the app-level token (invalid_auth)'),
    });
    expect(invalid.hand.waits()).toEqual([]);
    const bot = connect(refused('not_allowed_token_type'));
    await settle();
    expect(bot.told.statuses.at(-1)?.message).toContain('paste an app-level token (xapp-)');
    const away = connect([{ status: 503 }, ok({ url: URL_1 })]);
    await settle();
    expect(away.told.statuses.at(-1)).toEqual({
      state: 'disconnected',
      message: expect.stringContaining('Trying again in 1 s.'),
    });
    away.hand.fire(1_000);
    await settle();
    expect(away.server.sockets).toHaveLength(1);
  });

  it('never connects to an address that is not Slack’s', async () => {
    const c = connect([ok({ url: 'wss://evil.example.com/link' }), ok({})]);
    await settle();
    expect(c.server.sockets).toHaveLength(0);
    expect(c.told.statuses.at(-1)?.message).toBe('Slack gave no Socket Mode address. Trying again in 1 s.');
    expect(isSlackSocketUrl('wss://slack.com/link')).toBe(true);
    expect(isSlackSocketUrl('https://wss-primary.slack.com/link')).toBe(false);
    expect(isSlackSocketUrl('wss://slack.com.evil.io/link')).toBe(false);
    expect(isSlackSocketUrl('not a url')).toBe(false);
    expect(isSlackSocketUrl(7)).toBe(false);
  });

  it('says a network failure in words and tries again', async () => {
    const c = connect(new TypeError('fetch failed'));
    await settle();
    expect(c.told.statuses.at(-1)?.state).toBe('disconnected');
  });
});

describe('envelopes', () => {
  it('acks each at once, then hands its message on once, Slack’s retries and other envelopes acked and left', async () => {
    const c = connect();
    await settle();
    const socket = c.server.latest;
    socket.hello();
    socket.say(envelope('env-1', 'Ev01', mention()));
    expect(socket.sent).toEqual([{ envelope_id: 'env-1' }]);
    expect(c.told.messages).toEqual([
      {
        eventId: 'Ev01',
        teamId: 'T0AIRIA',
        type: 'app_mention',
        channel: 'C0GENERAL1',
        channelType: null,
        user: 'U0IHOR',
        botId: null,
        subtype: null,
        text: '<@U0BOT> Bro are you there?',
        ts: '1731490000.000100',
        threadTs: null,
        edited: false,
      },
    ]);
    socket.say(envelope('env-1', 'Ev01', mention()));
    socket.say({ ...envelope('env-2', 'Ev01', mention()), retry_attempt: 1, retry_reason: 'timeout' });
    socket.say(envelope('env-3', 'Ev02', { type: 'reaction_added', user: 'U0IHOR' }));
    socket.say({ type: 'slash_commands', envelope_id: 'env-4', payload: { command: '/mw' } });
    socket.say({ type: 'events_api', payload: {} });
    socket.say('not json');
    socket.say('[1]');
    expect(socket.sent.map((frame) => (frame as { envelope_id: string }).envelope_id)).toEqual([
      'env-1',
      'env-1',
      'env-2',
      'env-3',
      'env-4',
    ]);
    expect(c.told.messages).toHaveLength(1);
  });
});

describe('reconnecting', () => {
  it('opens a new connection at once when Slack refreshes one, and listens to the new one only', async () => {
    const c = connect([ok({ url: URL_1 }), ok({ url: URL_2 })]);
    await settle();
    const first = c.server.latest;
    first.hello();
    first.say({ type: 'disconnect', reason: 'refresh_requested' });
    await settle();
    expect(first.closedWith).toBe(1000);
    const second = c.server.latest;
    expect(second.url).toBe(URL_2);
    first.say(envelope('env-old', 'Ev09', mention()));
    first.closeFromSlack();
    expect(first.sent).toEqual([]);
    expect(c.hand.waits()).toEqual([30_000]);
    second.hello();
    second.say(envelope('env-9', 'Ev09', mention()));
    expect(c.told.messages).toHaveLength(1);
  });

  it('stops when Slack says Socket Mode was turned off', async () => {
    const c = connect();
    await settle();
    c.server.latest.hello();
    c.server.latest.say({ type: 'disconnect', reason: 'link_disabled' });
    expect(c.told.statuses.at(-1)).toEqual({
      state: 'error',
      message: expect.stringContaining('Socket Mode is off'),
    });
    expect(c.server.latest.closedWith).toBe(1000);
    expect(c.hand.waits()).toEqual([]);
  });

  it('opens again after a backoff when the connection closes, doubling up to the longest, reset by a hello', async () => {
    const c = connect();
    await settle();
    c.server.latest.hello();
    c.server.latest.closeFromSlack();
    expect(c.told.statuses.at(-1)?.message).toBe('Slack closed the connection. Trying again in 1 s.');
    c.hand.fire(1_000);
    await settle();
    c.server.latest.closeFromSlack();
    expect(c.hand.waits()).toEqual([2_000]);
    c.hand.fire(2_000);
    await settle();
    c.server.latest.closeFromSlack();
    c.hand.fire(4_000);
    await settle();
    c.server.latest.closeFromSlack();
    expect(c.hand.waits()).toEqual([4_000]);
    c.hand.fire(4_000);
    await settle();
    c.server.latest.hello();
    c.server.latest.closeFromSlack();
    expect(c.hand.waits()).toEqual([1_000]);
    expect(c.server.sockets).toHaveLength(5);
  });

  it('drops a connection that says no hello in time and opens another', async () => {
    const c = connect();
    await settle();
    const quiet = c.server.latest;
    c.hand.fire(30_000);
    expect(quiet.closedWith).toBe(1000);
    expect(c.told.statuses.at(-1)?.message).toBe('Slack said no hello. Trying again in 1 s.');
    quiet.closeFromSlack();
    expect(c.hand.waits()).toEqual([1_000]);
  });
});

describe('closing', () => {
  it('ends the connection for good: closed, its timers cleared, nothing opened again', async () => {
    const c = connect();
    await settle();
    c.server.latest.hello();
    c.socket.close();
    expect(c.server.latest.closedWith).toBe(1000);
    c.server.latest.closeFromSlack();
    expect(c.hand.waits()).toEqual([]);
    expect(c.server.sockets).toHaveLength(1);
  });

  it('opens nothing when closed before Slack gave the address, or while waiting to try again', async () => {
    const early = connect();
    early.socket.close();
    await settle();
    expect(early.server.sockets).toHaveLength(0);
    const waiting = connect({ status: 503 });
    await settle();
    waiting.socket.close();
    expect(waiting.hand.waits()).toEqual([]);
  });
});
