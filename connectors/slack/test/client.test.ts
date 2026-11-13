import { SlackError } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { slackClient } from '../src/client.ts';
import { fakeFetch, ok, SIGN_IN } from './fixtures/fetch.ts';

const CHANNEL = {
  id: 'C0123ABCD',
  name: 'general',
  is_private: false,
  is_im: false,
  is_mpim: false,
  is_archived: false,
  is_member: true,
  topic: { value: 'Company news' },
  purpose: { value: '' },
  num_members: 12,
};

const MESSAGE = {
  ts: '1731490000.000100',
  user: 'U01',
  text: 'Ship it',
  thread_ts: '1731490000.000100',
  reply_count: 2,
  reactions: [{ name: 'rocket', count: 3 }],
  files: [{ name: 'plan.pdf' }, { title: 'no name' }],
};

const client = (routes: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(routes);
  return { api: slackClient({ fetch: fake.fetch }), calls: fake.calls };
};

describe('the Slack connector', () => {
  it('lists conversations of the types asked, without archived ones, with the next cursor', async () => {
    const { api, calls } = client({
      'conversations.list': ok({
        channels: [CHANNEL, { id: 'D01', is_im: true, user: 'U02' }, 7],
        response_metadata: { next_cursor: 'abc' },
      }),
    });
    const page = await api.listConversations(SIGN_IN, { types: ['public_channel', 'im'], limit: 100 });
    expect(page.nextCursor).toBe('abc');
    expect(page.items[0]).toEqual({
      id: 'C0123ABCD',
      name: 'general',
      isPrivate: false,
      isIm: false,
      isMpim: false,
      isArchived: false,
      isMember: true,
      user: null,
      topic: 'Company news',
      purpose: null,
      members: 12,
    });
    expect(page.items[1]).toMatchObject({ id: 'D01', name: null, isIm: true, user: 'U02', isMember: null });
    expect(page.items[2]).toMatchObject({ id: '', name: null });
    expect(calls[0]?.form).toEqual({ types: 'public_channel,im', limit: '100', exclude_archived: 'true' });
  });

  it('reads one conversation, and opens a DM with a person', async () => {
    const { api, calls } = client({
      'conversations.info': ok({ channel: CHANNEL }),
      'conversations.open': [ok({ channel: { id: 'D09' } }), ok({ channel: {} })],
    });
    expect((await api.conversationInfo(SIGN_IN, 'C0123ABCD')).name).toBe('general');
    expect(await api.openDm(SIGN_IN, 'U02')).toBe('D09');
    expect(calls[1]?.form).toEqual({ users: 'U02', return_im: 'true' });
    await expect(api.openDm(SIGN_IN, 'U02')).rejects.toBeInstanceOf(SlackError);
  });

  it('reads a channel’s history and a thread’s replies', async () => {
    const { api, calls } = client({
      'conversations.history': ok({
        messages: [MESSAGE, { ts: '2', bot_id: 'B1', bot_profile: { name: 'CI' } }],
      }),
      'conversations.replies': ok({ messages: [MESSAGE], response_metadata: { next_cursor: '' } }),
    });
    const history = await api.history(SIGN_IN, 'C0123ABCD', { limit: 10, oldest: '1731400000' });
    expect(history.items[0]).toEqual({
      ts: '1731490000.000100',
      user: 'U01',
      botId: null,
      username: null,
      text: 'Ship it',
      subtype: null,
      threadTs: '1731490000.000100',
      replyCount: 2,
      reactions: [{ name: 'rocket', count: 3 }],
      files: ['plan.pdf'],
    });
    expect(history.items[1]).toMatchObject({ botId: 'B1', username: 'CI', text: '', replyCount: 0 });
    expect(calls[0]?.form).toEqual({ channel: 'C0123ABCD', limit: '10', oldest: '1731400000' });
    const thread = await api.replies(SIGN_IN, 'C0123ABCD', '1731490000.000100', { limit: 50 });
    expect(thread.nextCursor).toBeNull();
    expect(calls[1]?.form).toEqual({ channel: 'C0123ABCD', ts: '1731490000.000100', limit: '50' });
  });

  it('lists the people and reads one', async () => {
    const user = {
      id: 'U01',
      name: 'ihor',
      real_name: 'Ihor Herasko',
      tz: 'Europe/Kyiv',
      profile: { display_name: 'Ihor', title: 'CEO' },
    };
    const { api } = client({
      'users.list': ok({
        members: [user, { id: 'U02', name: 'ci', is_bot: true, deleted: true, profile: { real_name: 'CI' } }],
      }),
      'users.info': ok({ user }),
    });
    const page = await api.listUsers(SIGN_IN, { limit: 100 });
    expect(page.items).toEqual([
      {
        id: 'U01',
        name: 'ihor',
        realName: 'Ihor Herasko',
        displayName: 'Ihor',
        title: 'CEO',
        isBot: false,
        deleted: false,
        timeZone: 'Europe/Kyiv',
      },
      {
        id: 'U02',
        name: 'ci',
        realName: 'CI',
        displayName: null,
        title: null,
        isBot: true,
        deleted: true,
        timeZone: null,
      },
    ]);
    expect((await api.userInfo(SIGN_IN, 'U01')).title).toBe('CEO');
  });

  it('posts with no mention parsing or unfurls, as the name and icon given, with blocks as JSON', async () => {
    const { api, calls } = client({ 'chat.postMessage': ok({ channel: 'C0123ABCD', ts: '1731.1' }) });
    const posted = await api.postMessage(SIGN_IN, {
      channel: 'C0123ABCD',
      text: 'Hello',
      threadTs: '1731.0',
      username: 'QA',
      iconEmoji: ':robot_face:',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }],
    });
    expect(posted).toEqual({ channel: 'C0123ABCD', ts: '1731.1' });
    expect(calls[0]?.form).toEqual({
      channel: 'C0123ABCD',
      text: 'Hello',
      thread_ts: '1731.0',
      username: 'QA',
      icon_emoji: ':robot_face:',
      blocks: '[{"type":"section","text":{"type":"mrkdwn","text":"Hello"}}]',
      link_names: 'false',
      parse: 'none',
      unfurl_links: 'false',
      unfurl_media: 'false',
    });
    const bare = client({ 'chat.postMessage': ok() });
    expect(await bare.api.postMessage(SIGN_IN, { channel: 'D01', text: 'x' })).toEqual({
      channel: 'D01',
      ts: '',
    });
  });

  it('adds a reaction, and searches messages', async () => {
    const hit = {
      channel: { id: 'C0123ABCD', name: 'general', is_private: false },
      ts: '1731.2',
      user: 'U01',
      username: 'ihor',
      text: 'deploy done',
      permalink: 'https://airia.slack.com/archives/C0123ABCD/p17312',
    };
    const { api, calls } = client({
      'reactions.add': ok(),
      'search.messages': ok({ messages: { total: 1, paging: { page: 1, pages: 1 }, matches: [hit] } }),
    });
    await api.addReaction(SIGN_IN, { channel: 'C0123ABCD', timestamp: '1731.2', name: 'eyes' });
    expect(calls[0]?.form).toEqual({ channel: 'C0123ABCD', timestamp: '1731.2', name: 'eyes' });
    const found = await api.searchMessages(SIGN_IN, {
      query: 'deploy',
      count: 20,
      page: 1,
      sort: 'timestamp',
    });
    expect(found).toEqual({
      total: 1,
      page: 1,
      pages: 1,
      items: [
        {
          channel: { id: 'C0123ABCD', name: 'general', isIm: false, isMpim: false, isPrivate: false },
          ts: '1731.2',
          user: 'U01',
          username: 'ihor',
          text: 'deploy done',
          permalink: 'https://airia.slack.com/archives/C0123ABCD/p17312',
        },
      ],
    });
    expect(calls[1]?.form).toEqual({
      query: 'deploy',
      count: '20',
      page: '1',
      sort: 'timestamp',
      highlight: 'false',
    });
    const empty = client({ 'search.messages': ok({}) });
    expect(await empty.api.searchMessages(SIGN_IN, { query: 'x', count: 1, page: 1 })).toEqual({
      total: 0,
      page: 1,
      pages: 1,
      items: [],
    });
  });
});
