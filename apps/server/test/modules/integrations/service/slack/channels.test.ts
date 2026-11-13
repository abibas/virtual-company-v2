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
  SLACK_BOT_SCOPES,
  type SlackScene,
  setScopes,
  slackScene,
  slackTurn,
} from '../../../../fixtures/integrations/slack.ts';

/**
 * The conversations a Slack call names (S7.1e): a channel by its name (found in the channels the sign-in sees) or its id
 * (read unless the allowlist names that id), checked against the allowlist; DMs by their rights; a person's id only to
 * post a DM; and `slack_list_channels` kept to what the profile reaches. One turn serves every test.
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
    s = await slackScene(w);
    start = await slackTurn(w, s);
  })();
  await made;
}, 20_000);
afterEach(async () => {
  w.provider.reset();
  await part({});
  await setScopes(w.t.db, s.signIn.id, SLACK_BOT_SCOPES);
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const history = (channel: string) => callTool(s, start, 'slack_get_channel_history', { channel_id: channel });
const LIST = [rawChannel('C0RANDOM01', 'random'), rawChannel('C0GENERAL1', 'general')];

describe('a channel by its name', () => {
  it('is found in the channels the sign-in sees, then read by its id', async () => {
    answerSlack(w, {
      'conversations.list': [
        ok({ channels: [LIST[0]], response_metadata: { next_cursor: 'p2' } }),
        ok({ channels: LIST }),
      ],
      'conversations.history': ok({ messages: [rawMessage('1731.1', 'U0IHOR', 'Ship it')] }),
      'users.info': ok({ user: { id: 'U0IHOR', name: 'ihor', profile: { display_name: 'Ihor' } } }),
    });
    const result = await history('#General');
    expect(answerOf(result)).toMatchObject({ channel: '#general', channel_id: 'C0GENERAL1' });
    const lists = callsOf(w, 'conversations.list');
    expect(lists.map((call) => formOf(call))).toEqual([
      { types: 'public_channel,private_channel', limit: '200', exclude_archived: 'true' },
      { types: 'public_channel,private_channel', limit: '200', cursor: 'p2', exclude_archived: 'true' },
    ]);
    expect(formOf(callsOf(w, 'conversations.history')[0])).toMatchObject({
      channel: 'C0GENERAL1',
      limit: '10',
    });
  });

  it('is refused outside the allowlist, or when the sign-in sees no such channel', async () => {
    answerSlack(w, { 'conversations.list': ok({ channels: LIST }) });
    expect((await history('random')).text).toBe(
      "#random is outside the Slack channels this agent's profile reaches (#general).",
    );
    expect((await history('#nope')).text).toBe('No channel #nope that this Slack sign-in can see.');
    expect(callsOf(w, 'conversations.history')).toEqual([]);
  });

  it('looks in public channels only without the private channels’ scopes', async () => {
    await setScopes(w.t.db, s.signIn.id, ['channels:read', 'channels:history']);
    answerSlack(w, { 'conversations.list': ok({ channels: [] }) });
    await history('#general');
    expect(formOf(callsOf(w, 'conversations.list')[0]).types).toBe('public_channel');
  });
});

describe('a channel by its id', () => {
  it('is used as it is when the allowlist names that id, else read to check its name', async () => {
    await part({ channels: ['C0GENERAL1'] });
    answerSlack(w, { 'conversations.history': ok({ messages: [] }) });
    expect((await history('C0GENERAL1')).ok).toBe(true);
    expect(callsOf(w, 'conversations.info')).toEqual([]);
    await part({ channels: ['general'] });
    answerSlack(w, {
      'conversations.info': [
        ok({ channel: rawChannel('C0GENERAL1', 'general') }),
        ok({ channel: rawChannel('C0RANDOM01', 'random') }),
      ],
    });
    expect((await history('C0GENERAL1')).ok).toBe(true);
    expect((await history('C0RANDOM01')).text).toContain('#random is outside the Slack channels');
  });

  it('reaches every channel with all, but a group DM by the DM rights', async () => {
    await part({ channels: 'all' });
    answerSlack(w, {
      'conversations.info': [
        ok({ channel: rawChannel('C0RANDOM01', 'random') }),
        ok({ channel: rawChannel('G0GROUPDM1', 'mpdm-a--b-1', { is_mpim: true }) }),
      ],
      'conversations.history': ok({ messages: [] }),
    });
    expect((await history('C0RANDOM01')).ok).toBe(true);
    expect((await history('G0GROUPDM1')).text).toBe("Direct messages are off for this agent's profile.");
  });
});

describe('direct messages', () => {
  it('are read by a DM’s id only with DMs on, and posted only with post', async () => {
    expect((await history('D0IHOR0001')).text).toBe("Direct messages are off for this agent's profile.");
    await part({ dms: 'read' });
    answerSlack(w, { 'conversations.history': ok({ messages: [] }) });
    expect(answerOf(await history('D0IHOR0001'))).toMatchObject({ channel: 'D0IHOR0001' });
    const post = await callTool(s, start, 'slack_post_message', { channel_id: 'D0IHOR0001', text: 'Hi' });
    expect(post.text).toBe("This agent's profile may only read direct messages.");
  });

  it('go to a person by their id only to post, opening the DM', async () => {
    expect((await history('U0IHOR0001')).text).toContain('A person’s id (U…) only posts a direct message');
    const refused = await callTool(s, start, 'slack_post_message', { channel_id: 'U0IHOR0001', text: 'Hi' });
    expect(refused.text).toBe("Direct messages are off for this agent's profile.");
    await part({ dms: 'post' });
    answerSlack(w, {
      'conversations.open': ok({ channel: { id: 'D0IHOR0001' } }),
      'chat.postMessage': ok({ channel: 'D0IHOR0001', ts: '1731.9' }),
    });
    const posted = await callTool(s, start, 'slack_post_message', { channel_id: 'U0IHOR0001', text: 'Hi' });
    expect(answerOf(posted)).toMatchObject({ posted: true, channel: 'D0IHOR0001', ts: '1731.9' });
    expect(formOf(callsOf(w, 'conversations.open')[0])).toMatchObject({ users: 'U0IHOR0001' });
  });
});

describe('slack_list_channels', () => {
  it('lists a page of what the sign-in sees, kept to the allowlist, saying how many were left out', async () => {
    answerSlack(w, {
      'conversations.list': ok({ channels: LIST, response_metadata: { next_cursor: 'n2' } }),
    });
    const result = answerOf(await callTool(s, start, 'slack_list_channels', { limit: 50, cursor: 'c1' }));
    expect(result).toEqual({
      channels: [{ id: 'C0GENERAL1', name: '#general', member: true }],
      left_out: 1,
      next_cursor: 'n2',
    });
    expect(formOf(callsOf(w, 'conversations.list')[0])).toEqual({
      types: 'public_channel,private_channel',
      limit: '50',
      cursor: 'c1',
      exclude_archived: 'true',
    });
  });

  it('adds the DMs when they are on, and lists only them when reading channels is off', async () => {
    await part({ read: false, dms: 'read' });
    const dm = rawChannel('D0IHOR0001', null, { is_im: true, user: 'U0IHOR', is_member: undefined });
    answerSlack(w, { 'conversations.list': ok({ channels: [...LIST, dm] }) });
    const result = answerOf(await callTool(s, start, 'slack_list_channels', {}));
    expect(result).toEqual({ channels: [{ id: 'D0IHOR0001', dm: 'direct', user: 'U0IHOR' }], left_out: 2 });
    expect(formOf(callsOf(w, 'conversations.list')[0])).toMatchObject({ types: 'im,mpim', limit: '100' });
  });
});
