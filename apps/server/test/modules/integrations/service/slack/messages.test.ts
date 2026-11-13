import type { SlackRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import {
  answerOf,
  answerSlack,
  CHAT_GENERAL,
  callsOf,
  callTool,
  formOf,
  ok,
  putSlackPart,
  rawChannel,
  rawMessage,
  rawUser,
  SLACK_BOT_SCOPES,
  type SlackScene,
  setScopes,
  slackError,
  slackScene,
  slackTurn,
} from '../../../../fixtures/integrations/slack.ts';

/**
 * The Slack read tools through a live turn (S7.1e): a channel's history and a thread with their authors by name, the
 * bot not invited said as what to do, the users, and a user token's search kept to the profile's channels and DMs.
 */

let w: ChatsWorld;
let s: SlackScene;
let start: TurnStart;

const part = (rights: Partial<SlackRights>) =>
  putSlackPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...CHAT_GENERAL, ...rights } });

beforeAll(async () => {
  w = await chatsWorld();
});
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await slackScene(w, { user: true });
    start = await slackTurn(w, s);
  })();
  await made;
}, 20_000);
afterEach(async () => {
  w.provider.reset();
  await part({});
  await setScopes(w.t.db, s.signIn.id, [...SLACK_BOT_SCOPES, 'search:read']);
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const GENERAL = { 'conversations.list': ok({ channels: [rawChannel('C0GENERAL1', 'general')] }) };

describe('slack_get_channel_history: “what’s new in #general?”', () => {
  it('reads the latest messages, newest first, with their authors by name, threads and reactions', async () => {
    answerSlack(w, {
      ...GENERAL,
      'conversations.history': ok({
        messages: [
          rawMessage('1731490000.000200', 'U0ANNA', 'Deploy is done', {
            reply_count: 2,
            thread_ts: '1731490000.000200',
            reactions: [{ name: 'tada', count: 3 }],
          }),
          rawMessage('1731489000.000100', 'U0IHOR', 'Deploying now'),
          { ts: '1731488000.000100', bot_id: 'B0CI', username: 'CI', text: 'Build green' },
        ],
        response_metadata: { next_cursor: 'older' },
      }),
      'users.info': [ok({ user: rawUser('U0ANNA', 'Anna') }), slackError('user_not_found')],
    });
    const result = answerOf(
      await callTool(s, start, 'slack_get_channel_history', {
        channel_id: '#general',
        limit: 3,
        oldest: '1731400000',
      }),
    );
    expect(result).toEqual({
      channel: '#general',
      channel_id: 'C0GENERAL1',
      messages: [
        {
          ts: '1731490000.000200',
          at: '2024-11-13T09:26:40.000Z',
          user: 'Anna',
          user_id: 'U0ANNA',
          text: 'Deploy is done',
          replies: 2,
          reactions: 'tada 3',
        },
        {
          ts: '1731489000.000100',
          at: '2024-11-13T09:10:00.000Z',
          user: 'U0IHOR',
          user_id: 'U0IHOR',
          text: 'Deploying now',
        },
        {
          ts: '1731488000.000100',
          at: '2024-11-13T08:53:20.000Z',
          user: 'CI',
          bot: 'CI',
          text: 'Build green',
        },
      ],
      next_cursor: 'older',
    });
    expect(formOf(callsOf(w, 'conversations.history')[0])).toEqual({
      channel: 'C0GENERAL1',
      limit: '3',
      oldest: '1731400000',
    });
    expect(callsOf(w, 'users.info').map((call) => formOf(call).user)).toEqual(['U0ANNA', 'U0IHOR']);
  });

  it('keeps the authors’ ids without users:read', async () => {
    await setScopes(w.t.db, s.signIn.id, ['channels:read', 'channels:history']);
    answerSlack(w, {
      ...GENERAL,
      'conversations.history': ok({ messages: [rawMessage('1.1', 'U0ANNA', 'Hi')] }),
    });
    const result = answerOf(
      await callTool(s, start, 'slack_get_channel_history', { channel_id: '#general' }),
    );
    expect(result.messages).toEqual([
      { ts: '1.1', at: '1970-01-01T00:00:01.000Z', user: 'U0ANNA', user_id: 'U0ANNA', text: 'Hi' },
    ]);
    expect(callsOf(w, 'users.info')).toEqual([]);
  });

  it('says to invite the bot when it is not in the channel', async () => {
    answerSlack(w, { ...GENERAL, 'conversations.history': slackError('not_in_channel') });
    expect((await callTool(s, start, 'slack_get_channel_history', { channel_id: '#general' })).text).toBe(
      'The bot is not in #general: invite the bot to #general in Slack (/invite @ihor), then try again.',
    );
  });
});

describe('slack_get_thread_replies and the users', () => {
  it('reads a thread, its first message first', async () => {
    answerSlack(w, {
      ...GENERAL,
      'conversations.replies': ok({
        messages: [
          rawMessage('1.1', 'U0ANNA', 'Q?', { thread_ts: '1.1', reply_count: 1 }),
          rawMessage('1.2', 'U0ANNA', 'A.', { thread_ts: '1.1' }),
        ],
        response_metadata: { next_cursor: 'more' },
      }),
      'users.info': ok({ user: rawUser('U0ANNA', 'Anna') }),
    });
    const input = { channel_id: '#general', thread_ts: '1.1', limit: 20 };
    const result = answerOf(await callTool(s, start, 'slack_get_thread_replies', input));
    expect(result).toMatchObject({ channel_id: 'C0GENERAL1', thread_ts: '1.1', next_cursor: 'more' });
    expect(result.messages).toEqual([
      { ts: '1.1', at: '1970-01-01T00:00:01.000Z', user: 'Anna', user_id: 'U0ANNA', text: 'Q?', replies: 1 },
      {
        ts: '1.2',
        at: '1970-01-01T00:00:01.000Z',
        user: 'Anna',
        user_id: 'U0ANNA',
        text: 'A.',
        thread_ts: '1.1',
      },
    ]);
    expect(formOf(callsOf(w, 'conversations.replies')[0])).toEqual({
      channel: 'C0GENERAL1',
      ts: '1.1',
      limit: '20',
    });
  });

  it('lists the people and reads one', async () => {
    answerSlack(w, {
      'users.list': ok({
        members: [rawUser('U0ANNA', 'Anna', { tz: 'Europe/Kyiv' })],
        response_metadata: { next_cursor: 'u2' },
      }),
      'users.info': ok({ user: rawUser('U0BOT', 'ci', { is_bot: true, profile: { title: 'Builds' } }) }),
    });
    expect(answerOf(await callTool(s, start, 'slack_get_users', { limit: 10 }))).toEqual({
      users: [{ id: 'U0ANNA', name: 'Anna', real_name: 'Anna', display_name: 'Anna', tz: 'Europe/Kyiv' }],
      next_cursor: 'u2',
    });
    expect(answerOf(await callTool(s, start, 'slack_get_user_profile', { user_id: 'U0BOT' }))).toEqual({
      id: 'U0BOT',
      name: 'ci',
      real_name: 'ci',
      title: 'Builds',
      bot: true,
    });
  });
});

describe('slack_search_messages (a user token with search:read)', () => {
  const hit = (channel: Record<string, unknown>, ts: string) => ({
    channel,
    ts,
    user: 'U0ANNA',
    username: 'anna',
    text: 'deploy',
    permalink: `https://airia.slack.com/archives/x/p${ts}`,
  });

  it('keeps the hits in the profile’s channels and DMs, saying how many it left out', async () => {
    await part({ search: true, dms: 'read' });
    answerSlack(w, {
      'search.messages': ok({
        messages: {
          total: 3,
          paging: { page: 1, pages: 1 },
          matches: [
            hit({ id: 'C0GENERAL1', name: 'general' }, '1.1'),
            hit({ id: 'C0RANDOM01', name: 'random' }, '1.2'),
            hit({ id: 'D0IHOR0001', is_im: true }, '1.3'),
          ],
        },
      }),
    });
    const input = { query: 'deploy', count: 5, sort: 'timestamp', sort_dir: 'desc' };
    const result = answerOf(await callTool(s, start, 'slack_search_messages', input));
    expect(result).toMatchObject({ query: 'deploy', total: 3, page: 1, pages: 1, left_out: 1 });
    expect((result.messages as { channel_id: string }[]).map((one) => one.channel_id)).toEqual([
      'C0GENERAL1',
      'D0IHOR0001',
    ]);
    expect(formOf(callsOf(w, 'search.messages')[0])).toEqual({
      query: 'deploy',
      count: '5',
      page: '1',
      sort: 'timestamp',
      sort_dir: 'desc',
      highlight: 'false',
    });
  });
});
