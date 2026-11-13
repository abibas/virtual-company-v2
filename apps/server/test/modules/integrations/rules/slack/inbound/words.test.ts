import { describe, expect, it } from 'vitest';
import {
  ANSWER_POST_MAX,
  answerText,
  capWords,
  couldNotAnswer,
  inboundPrompt,
  messageLink,
  notAllowedWords,
  oneLine,
  placeWords,
  slackChatTitle,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/words.ts';

/** The words of receiving Slack messages (2026-11-13). */

const GENERAL = { id: 'C0GENERAL1', name: 'general', dm: false };
const DM = { id: 'D0DM', name: null, dm: true };
const GROUP = { id: 'G0GROUP', name: null, dm: true };

describe('a place', () => {
  it('is a channel’s name, a DM, a group DM, or a channel’s id when Slack did not name it', () => {
    const unnamed = { id: 'C0SECRET1', name: null, dm: false };
    expect([GENERAL, DM, GROUP, unnamed].map(placeWords)).toEqual([
      '#general',
      'a DM',
      'a group DM',
      '#C0SECRET1',
    ]);
    expect(slackChatTitle(unnamed, 'hi')).toBe('Slack · #C0SECRET1 · hi');
  });
});

describe('a chat’s title', () => {
  it('names the place and the first words, cut to a title', () => {
    expect(slackChatTitle(GENERAL, 'Bro   are you there?')).toBe('Slack · #general · Bro are you there?');
    expect(slackChatTitle(DM, 'hi')).toBe('Slack · DM · hi');
    expect(slackChatTitle(GROUP, '')).toBe('Slack · group DM');
    const long = slackChatTitle(GENERAL, 'word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
    expect(oneLine('a\n b', 10)).toBe('a b');
  });
});

describe('a message’s link', () => {
  it('points at the message, in its thread when it is a reply', () => {
    const message = { channel: 'C1', ts: '1731.000100', threadTs: null };
    expect(messageLink('https://x.slack.com/', message)).toBe('https://x.slack.com/archives/C1/p1731000100');
    expect(messageLink('https://x.slack.com', { ...message, threadTs: '1731.000100' })).toBe(
      'https://x.slack.com/archives/C1/p1731000100',
    );
    expect(messageLink('https://x.slack.com', { ...message, threadTs: '1700.000100' })).toBe(
      'https://x.slack.com/archives/C1/p1731000100?thread_ts=1700.000100&cid=C1',
    );
    expect(messageLink(null, message)).toBeNull();
  });
});

describe('the prompt', () => {
  it('is a header line, then the message', () => {
    const prompt = inboundPrompt({
      from: 'Ihor',
      place: GENERAL,
      link: 'https://l',
      threaded: true,
      text: 'hi',
    });
    expect(prompt).toBe(
      'Slack message from Ihor in #general (https://l). Your final reply is posted in that thread under your name.\n\nhi',
    );
    const dm = inboundPrompt({ from: 'Ihor', place: DM, link: null, threaded: false, text: '' });
    expect(dm).toBe(
      'Slack message from Ihor in a DM with you. Your final reply is posted there under your name.\n\n(no text)',
    );
    const group = inboundPrompt({
      from: 'Ihor',
      place: GROUP,
      link: null,
      threaded: true,
      text: 'x'.repeat(30_000),
    });
    expect(group.length).toBeLessThanOrEqual(20_000);
    expect(group).toContain('in a group DM.');
  });
});

describe('the notices and the answer', () => {
  it('say where an agent may not post, the cap, a failure; and cut a long answer', () => {
    expect(notAllowedWords('TEST DEV', GENERAL)).toBe("TEST DEV isn't allowed to post in #general.");
    expect(notAllowedWords('TEST DEV', DM)).toBe("TEST DEV isn't allowed to post in direct messages.");
    expect(capWords(30)).toBe(
      'This Slack connection is at its 30 answers an hour: agents answer here again within the hour.',
    );
    expect(couldNotAnswer(null)).toBe("Couldn't answer: the turn failed");
    expect(couldNotAnswer('  ')).toBe("Couldn't answer: the turn failed");
    expect(couldNotAnswer('x'.repeat(300))).toHaveLength(217);
    expect(answerText('short')).toBe('short');
    expect(answerText('y'.repeat(ANSWER_POST_MAX + 5))).toHaveLength(ANSWER_POST_MAX);
  });
});
