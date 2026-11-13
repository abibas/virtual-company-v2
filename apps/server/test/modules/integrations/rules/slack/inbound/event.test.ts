import type { SlackInboundMessage } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import {
  botOf,
  inboundKind,
  isDirect,
  isThreadReply,
  mayWake,
  messageKey,
  recentKeys,
  threadRoot,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/event.ts';

/** Which Slack messages wake an agent (2026-11-13): the kinds, what is ignored, the conversation, who may wake. */

const BOT = botOf({
  userId: 'U0BOT',
  botId: 'B0BOT',
  user: 'mw-bot',
  teamId: 'T1',
  url: 'https://x.slack.com/',
  scopes: ['a'],
});

const message = (fields: Partial<SlackInboundMessage> = {}): SlackInboundMessage => ({
  eventId: 'Ev1',
  teamId: 'T1',
  type: 'message',
  channel: 'C0GENERAL1',
  channelType: 'channel',
  user: 'U0IHOR',
  botId: null,
  subtype: null,
  text: 'hello',
  ts: '2.0',
  threadTs: null,
  edited: false,
  ...fields,
});

describe('a bot sign-in’s bot', () => {
  it('is read from its account details, empty values as none', () => {
    expect(BOT).toEqual({
      userId: 'U0BOT',
      botId: 'B0BOT',
      name: 'mw-bot',
      teamId: 'T1',
      url: 'https://x.slack.com/',
      scopes: ['a'],
    });
    expect(botOf({ userId: '', scopes: 'x' })).toEqual({
      userId: null,
      botId: null,
      name: null,
      teamId: null,
      url: null,
      scopes: [],
    });
  });
});

describe('a message', () => {
  it('is a DM, a mention or a thread reply', () => {
    expect(inboundKind(message({ channel: 'D0DM', channelType: 'im' }), BOT)).toEqual({ kind: 'dm' });
    expect(inboundKind(message({ channel: 'D0DM', channelType: null }), BOT)).toEqual({ kind: 'dm' });
    expect(inboundKind(message({ type: 'app_mention' }), BOT)).toEqual({ kind: 'mention' });
    expect(inboundKind(message({ text: 'hey <@U0BOT|mw-bot> there' }), BOT)).toEqual({ kind: 'mention' });
    expect(inboundKind(message({ threadTs: '1.0' }), BOT)).toEqual({ kind: 'thread' });
    expect(inboundKind(message({ threadTs: '1.0', subtype: 'thread_broadcast' }), BOT)).toEqual({
      kind: 'thread',
    });
    expect(inboundKind(message({ type: 'app_mention', subtype: 'file_share' }), BOT)).toEqual({
      kind: 'mention',
    });
  });

  it('is ignored when the bot or another bot wrote it, it is an edit, another subtype, no one’s, or for no one', () => {
    expect(inboundKind(message({ botId: 'B0BOT' }), BOT)).toEqual({ ignored: 'own' });
    expect(inboundKind(message({ user: 'U0BOT' }), BOT)).toEqual({ ignored: 'own' });
    expect(inboundKind(message({ botId: 'B0CI' }), BOT)).toEqual({ ignored: 'bot' });
    expect(inboundKind(message({ subtype: 'bot_message' }), BOT)).toEqual({ ignored: 'bot' });
    expect(inboundKind(message({ edited: true }), BOT)).toEqual({ ignored: 'edit' });
    expect(inboundKind(message({ subtype: 'message_deleted' }), BOT)).toEqual({ ignored: 'edit' });
    expect(inboundKind(message({ subtype: 'channel_join' }), BOT)).toEqual({ ignored: 'subtype' });
    expect(inboundKind(message({ user: null }), BOT)).toEqual({ ignored: 'no_author' });
    expect(inboundKind(message({ threadTs: '2.0' }), BOT)).toEqual({ ignored: 'not_for_us' });
    expect(inboundKind(message({ text: '<@U0BOT>' }), { ...BOT, userId: null })).toEqual({
      ignored: 'not_for_us',
    });
  });

  it('has a key, a conversation, and says whether it is a DM or a thread reply', () => {
    expect(messageKey(message())).toBe('C0GENERAL1/2.0');
    expect(threadRoot(message())).toBe('2.0');
    expect(threadRoot(message({ threadTs: '1.0' }))).toBe('1.0');
    expect(threadRoot(message({ channel: 'D0DM', channelType: 'im' }))).toBeNull();
    expect(threadRoot(message({ channel: 'D0DM', channelType: 'im', threadTs: '1.0' }))).toBe('1.0');
    expect(isDirect(message({ channelType: 'mpim' }))).toBe(false);
    expect(isThreadReply(message({ threadTs: '2.0' }))).toBe(false);
  });
});

describe('who may wake agents', () => {
  it('anyone, or the people listed', () => {
    const people = [{ id: 'U0IHOR', name: 'Ihor', image: null }];
    expect(mayWake({ wake: 'anyone', people: [] }, 'U0X')).toBe(true);
    expect(mayWake({ wake: 'listed', people }, 'U0IHOR')).toBe(true);
    expect(mayWake({ wake: 'listed', people }, 'U0X')).toBe(false);
  });
});

describe('recent keys', () => {
  it('say a key seen lately, forgetting the oldest', () => {
    const seen = recentKeys(1);
    expect(seen('a')).toBe(false);
    expect(seen('a')).toBe(true);
    expect(seen('b')).toBe(false);
    expect(seen('a')).toBe(false);
  });
});
