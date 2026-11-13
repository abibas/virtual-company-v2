import { agents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { SlackRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { eq } from 'drizzle-orm';
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
  principalOf,
  putSlackPart,
  rawChannel,
  SLACK_BOT_SCOPES,
  type SlackScene,
  setScopes,
  slackError,
  slackScene,
  slackTurn,
  toolAudit,
} from '../../../../fixtures/integrations/slack.ts';

/**
 * The Slack write tools through a live turn (S7.1e): a post and a thread reply under the agent's name and emoji icon on
 * a bot with `chat:write.customize` (as the bot without it), always with the footer "via Most Wanted · <agent>" and with
 * every mention of many people taken out; and a reaction. Each is audited as the agent on the message.
 */

let w: ChatsWorld;
let s: SlackScene;
let start: TurnStart;
let agentPrincipal: string;

const part = (rights: Partial<SlackRights>) =>
  putSlackPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...CHAT_GENERAL, ...rights } });

beforeAll(async () => {
  w = await chatsWorld();
});
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await slackScene(w);
    await rawDb(w.t.db)
      .update(agents)
      .set({ iconKind: 'emoji', iconEmoji: '🤖' })
      .where(eq(agents.id, s.agentId));
    start = await slackTurn(w, s, 'Post a test message in #general');
    agentPrincipal = await principalOf(w.t.db, s.agentId);
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

const GENERAL = { 'conversations.list': ok({ channels: [rawChannel('C0GENERAL1', 'general')] }) };
const post = (text: string, channel = '#general') =>
  callTool(s, start, 'slack_post_message', { channel_id: channel, text });
const footer = () => ({
  type: 'context',
  elements: [{ type: 'plain_text', text: `via Most Wanted · ${s.agentName}`, emoji: true }],
});

describe('slack_post_message', () => {
  it('posts under the agent’s name and icon with the footer, no mentions parsed, audited as the agent', async () => {
    answerSlack(w, { ...GENERAL, 'chat.postMessage': ok({ channel: 'C0GENERAL1', ts: '1731.5' }) });
    const result = await post('Test message from *Most Wanted*');
    expect(answerOf(result)).toEqual({
      posted: true,
      channel: '#general',
      channel_id: 'C0GENERAL1',
      ts: '1731.5',
      as: s.agentName,
    });
    const form = formOf(callsOf(w, 'chat.postMessage')[0]);
    expect(form).toMatchObject({
      channel: 'C0GENERAL1',
      text: 'Test message from *Most Wanted*',
      username: s.agentName,
      icon_emoji: ':robot_face:',
      link_names: 'false',
      parse: 'none',
      unfurl_links: 'false',
    });
    expect(JSON.parse(form.blocks as string)).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Test message from *Most Wanted*' } },
      footer(),
    ]);
    expect(await toolAudit(w.t.db, 'slack_message', 'C0GENERAL1/1731.5')).toEqual([
      ['tool:slack_post_message', agentPrincipal, start.turnId, 'channel', '#general'],
      ['tool:slack_post_message', agentPrincipal, start.turnId, 'text', 'Test message from *Most Wanted*'],
    ]);
  });

  it('strips @here, @channel, @everyone and group mentions, says so, and refuses a post of nothing else', async () => {
    answerSlack(w, { ...GENERAL, 'chat.postMessage': ok({ channel: 'C0GENERAL1', ts: '1731.6' }) });
    const result = answerOf(await post('<!here> deploy at 5, @channel <!subteam^S01|@devs> <@U0ANNA> ok'));
    expect(result.mentions_stripped).toEqual(['@here', '@devs', '@channel']);
    expect(formOf(callsOf(w, 'chat.postMessage')[0]).text).toBe(
      'here deploy at 5, channel devs <@U0ANNA> ok',
    );
    const audit = await toolAudit(w.t.db, 'slack_message', 'C0GENERAL1/1731.6');
    expect(audit.at(-1)).toEqual([
      'tool:slack_post_message',
      agentPrincipal,
      start.turnId,
      'mentionsStripped',
      ['@here', '@devs', '@channel'],
    ]);
    expect((await post(' \n ')).text).toBe('The message has no text: write what to post.');
  });

  it('posts as the bot itself without chat:write.customize, in sections for a long text', async () => {
    await setScopes(w.t.db, s.signIn.id, ['channels:read', 'channels:history', 'chat:write']);
    answerSlack(w, { ...GENERAL, 'chat.postMessage': ok({ channel: 'C0GENERAL1', ts: '1731.7' }) });
    const long = `${'a'.repeat(2999)}\n${'b'.repeat(10)}`;
    expect(answerOf(await post(long)).as).toBe('mw-bot');
    const form = formOf(callsOf(w, 'chat.postMessage')[0]);
    expect(form).not.toHaveProperty('username');
    expect(form).not.toHaveProperty('icon_emoji');
    expect(JSON.parse(form.blocks as string)).toHaveLength(3);
  });

  it('is refused outside the allowlist, and says to invite the bot when it is not in the channel', async () => {
    answerSlack(w, {
      'conversations.list': ok({
        channels: [rawChannel('C0GENERAL1', 'general'), rawChannel('C0RANDOM01', 'random')],
      }),
      'chat.postMessage': slackError('not_in_channel'),
    });
    expect((await post('Hi', '#random')).text).toContain('#random is outside the Slack channels');
    expect((await post('Hi')).text).toBe(
      'The bot is not in #general: invite the bot to #general in Slack (/invite @mw-bot), then try again.',
    );
  });
});

describe('slack_reply_to_thread and slack_add_reaction', () => {
  it('replies in the thread, audited with it', async () => {
    answerSlack(w, { ...GENERAL, 'chat.postMessage': ok({ channel: 'C0GENERAL1', ts: '1731.8' }) });
    const input = { channel_id: '#general', thread_ts: '1731.1', text: 'Done.' };
    expect(answerOf(await callTool(s, start, 'slack_reply_to_thread', input))).toMatchObject({
      thread_ts: '1731.1',
    });
    expect(formOf(callsOf(w, 'chat.postMessage')[0])).toMatchObject({ thread_ts: '1731.1', text: 'Done.' });
    const audit = await toolAudit(w.t.db, 'slack_message', 'C0GENERAL1/1731.8');
    expect(audit.map(([action, , , field, value]) => [action, field, value])).toEqual([
      ['tool:slack_reply_to_thread', 'channel', '#general'],
      ['tool:slack_reply_to_thread', 'thread', 'C0GENERAL1/1731.1'],
      ['tool:slack_reply_to_thread', 'text', 'Done.'],
    ]);
  });

  it('adds a reaction by its name without colons, audited; Slack’s refusal said in words', async () => {
    answerSlack(w, { ...GENERAL, 'reactions.add': [ok(), slackError('already_reacted')] });
    const input = { channel_id: '#general', timestamp: '1731.1', reaction: ':eyes:' };
    expect(answerOf(await callTool(s, start, 'slack_add_reaction', input))).toEqual({
      reacted: 'eyes',
      channel: '#general',
      ts: '1731.1',
    });
    expect(formOf(callsOf(w, 'reactions.add')[0])).toEqual({
      channel: 'C0GENERAL1',
      timestamp: '1731.1',
      name: 'eyes',
    });
    expect(await toolAudit(w.t.db, 'slack_message', 'C0GENERAL1/1731.1')).toEqual([
      ['tool:slack_add_reaction', agentPrincipal, start.turnId, 'channel', '#general'],
      ['tool:slack_add_reaction', agentPrincipal, start.turnId, 'reaction', 'eyes'],
    ]);
    expect((await callTool(s, start, 'slack_add_reaction', input)).text).toBe(
      'Slack refused the request as written. Slack said: already_reacted.',
    );
  });
});
