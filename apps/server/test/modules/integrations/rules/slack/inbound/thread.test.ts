import type { SlackMessage } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import {
  historyScopes,
  missingScopeLine,
  THREAD_BUDGET,
  THREAD_HEAD,
  THREAD_MESSAGE_MAX,
  threadBlock,
  threadLine,
  unreadLine,
  unseenMessages,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/thread.ts';

/** A thread's message as the port reads it. */
const msg = (ts: string, fields: Partial<SlackMessage> = {}): SlackMessage => ({
  ts,
  user: 'U1',
  botId: null,
  username: null,
  text: `at ${ts}`,
  subtype: null,
  threadTs: '100.000000',
  replyCount: 0,
  reactions: [],
  files: [],
  ...fields,
});

const NAMES = new Map([
  ['U1', 'Erich'],
  ['U2', 'Ihor'],
]);

describe('the history scope a thread needs', () => {
  it('goes by the channel type, else by the id', () => {
    expect(historyScopes({ channel: 'C1', channelType: 'channel' })).toEqual(['channels:history']);
    expect(historyScopes({ channel: 'C1', channelType: 'group' })).toEqual(['groups:history']);
    expect(historyScopes({ channel: 'D1', channelType: 'im' })).toEqual(['im:history']);
    expect(historyScopes({ channel: 'G1', channelType: 'mpim' })).toEqual(['mpim:history']);
    expect(historyScopes({ channel: 'D1', channelType: null })).toEqual(['im:history']);
    expect(historyScopes({ channel: 'G1', channelType: null })).toEqual(['groups:history', 'mpim:history']);
    expect(historyScopes({ channel: 'C1', channelType: null })).toEqual([
      'channels:history',
      'groups:history',
    ]);
    expect(historyScopes({ channel: 'C1', channelType: 'odd' })).toEqual([
      'channels:history',
      'groups:history',
    ]);
  });

  it('says in one line what is missing, or why Slack did not answer', () => {
    expect(missingScopeLine(['channels:history'])).toBe(
      'Earlier in this thread: not read: the Slack app has no channels:history scope (add it on its OAuth & ' +
        'Permissions page and reinstall it). Ask for the earlier messages if you need them.',
    );
    expect(unreadLine('Slack found nothing there.\nreally')).toBe(
      'Earlier in this thread: could not be read (Slack found nothing there. really). Ask for the earlier messages if ' +
        'you need them.',
    );
  });
});

describe('the messages the agent has not seen', () => {
  const at = { root: '100.000000', ts: '500.000000' };
  const thread = [
    msg('300.000000'),
    msg('100.000000'),
    msg('200.000000'),
    msg('350.000000'),
    msg('500.000000'),
    msg('600.000000'),
  ];

  it('are all before the new message when it saw nothing, oldest first, the first message first', () => {
    const unseen = unseenMessages(thread, at, { seenUntil: null, own: new Set() });
    expect(unseen.map((one) => one.ts)).toEqual(['100.000000', '200.000000', '300.000000', '350.000000']);
  });

  it('are those after its last successful turn, never its own posts; the first message always', () => {
    const unseen = unseenMessages(thread, at, { seenUntil: 250, own: new Set(['350.000000']) });
    expect(unseen.map((one) => one.ts)).toEqual(['100.000000', '300.000000']);
  });

  it('leave out the first message when it is the new one', () => {
    expect(
      unseenMessages(
        [msg('100.000000')],
        { root: '100.000000', ts: '100.000000' },
        {
          seenUntil: null,
          own: new Set(),
        },
      ),
    ).toEqual([]);
  });
});

describe('a message as a line', () => {
  it('names its author, renders its markup, and shows what it shares by address, and its files', () => {
    const pr = 'https://github.com/AiriaLLC/airia-platform/pull/7';
    const line = threadLine(
      msg('100.000000', {
        text: '<@U2> approve <https://x.dev/a|this>\nplease',
        attachments: [
          { url: pr, title: '#7 Fix' },
          { url: 'https://y.dev', title: null },
          { url: null, title: 'Just a title' },
        ],
        files: ['plan.pdf'],
      }),
      NAMES,
      '100.000000',
    );
    expect(line).toBe(
      `- Erich (first message): @Ihor approve this (https://x.dev/a)\n  please [shared: #7 Fix (${pr}); ` +
        'https://y.dev; Just a title] [files: plan.pdf]',
    );
  });

  it('names a bot by the name it posted under, an unknown person by their id, and cuts a long text', () => {
    expect(threadLine(msg('2', { user: null, username: 'QA' }), NAMES, '1')).toBe('- QA: at 2');
    expect(threadLine(msg('2', { user: null }), NAMES, '1')).toBe('- a bot: at 2');
    expect(threadLine(msg('2', { user: 'U9' }), NAMES, '1')).toBe('- U9: at 2');
    const long = threadLine(msg('2', { text: 'x'.repeat(THREAD_MESSAGE_MAX + 50) }), NAMES, '1');
    expect(long.length).toBe('- Erich: '.length + THREAD_MESSAGE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('the block', () => {
  it('is nothing without lines, and its head and lines within the budget', () => {
    expect(threadBlock([], true)).toBeNull();
    expect(threadBlock(['- a: 1', '- b: 2'], true)).toBe(`${THREAD_HEAD}\n- a: 1\n- b: 2`);
    expect(threadBlock(['- b: 2'], false)).toBe(`${THREAD_HEAD}\n- b: 2`);
  });

  it('drops the oldest first past the budget, keeping the first message, and says how many', () => {
    const big = (i: number) => `- p: ${i}${'x'.repeat(3_000)}`;
    const block = threadBlock(['- root', big(1), big(2), big(3)], true) as string;
    expect(block.split('\n').map((line) => line.slice(0, 8))).toEqual([
      THREAD_HEAD.slice(0, 8),
      '- root',
      '- (1 ear',
      '- p: 2xx',
      '- p: 3xx',
    ]);
    expect(block).toContain('(1 earlier message left out)');
    expect(block.length).toBeLessThan(THREAD_BUDGET + 100);
    const many = threadBlock([big(1), big(2), big(3), big(4)], false) as string;
    expect(many).toContain('(2 earlier messages left out)');
  });
});
