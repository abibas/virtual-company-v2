import { describe, expect, it } from 'vitest';
import {
  ANSWER_POST_MAX,
  answerText,
  capWords,
  couldNotAnswer,
  inboundPrompt,
  messageLink,
  notAllowedWords,
  notPostedReason,
  oneLine,
  placeWords,
  slackChatTitle,
  stoppedWords,
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

  it('carries a reply’s thread context between the header and the message', () => {
    const context =
      'Earlier in this thread:\n- Erich (first message): Approve: https://github.com/a/b/pull/1';
    const prompt = inboundPrompt({
      from: 'Ihor',
      place: GENERAL,
      link: null,
      threaded: true,
      text: 'go',
      context,
    });
    expect(prompt.split('\n\n')).toEqual([
      'Slack message from Ihor in #general. Your final reply is posted in that thread under your name.',
      context,
      'Their message:',
      'go',
    ]);
    const long = inboundPrompt({
      from: 'I',
      place: GENERAL,
      link: null,
      threaded: true,
      text: 'z'.repeat(30_000),
      context,
    });
    expect(long.length).toBeLessThanOrEqual(20_000);
    expect(long).toContain(context);
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
    expect(couldNotAnswer(stoppedWords('Airia devbox is stopped'))).toBe(
      'Couldn\'t answer: Airia devbox is stopped. Start it, or turn on "Start when you message an agent on it" for ' +
        'the box.',
    );
    expect(stoppedWords('Box is stopped.')).toMatch(/^Box is stopped\. Start it/);
    expect(answerText('short')).toBe('short');
    expect(answerText('y'.repeat(ANSWER_POST_MAX + 5))).toHaveLength(ANSWER_POST_MAX);
  });
});

describe('why an answer was not posted (T-22)', () => {
  const LABEL = 'Slack Airia Bro';
  const said = (code: string, slackError: string | null = null, label: string | null = LABEL) =>
    notPostedReason(label, { code, slackError });

  it('names the bot sign-in at fault: gone, revoked, not a bot token', () => {
    expect(notPostedReason(LABEL, { signIn: 'gone' })).toEqual({
      reason: 'its Slack sign-in is gone',
      signIn: true,
    });
    expect(notPostedReason(LABEL, { signIn: 'revoked' })).toEqual({
      reason: "the Slack sign-in 'Slack Airia Bro' was revoked",
      signIn: true,
    });
    expect(notPostedReason(null, { signIn: 'revoked' })).toEqual({
      reason: 'the Slack sign-in was revoked',
      signIn: true,
    });
    expect(notPostedReason(LABEL, { signIn: 'not_bot' })).toEqual({
      reason: "the Slack sign-in 'Slack Airia Bro' is not a bot token (xoxb-)",
      signIn: true,
    });
    expect(notPostedReason(null, { signIn: 'not_bot' }).reason).toBe(
      'the Slack sign-in is not a bot token (xoxb-)',
    );
  });

  it('blames the sign-in for a refused token or a missing scope, on one line and cut', () => {
    expect(said('needs_sign_in', 'invalid_auth')).toEqual({
      reason: "the Slack sign-in 'Slack Airia Bro' needs a new token",
      signIn: true,
    });
    expect(said('needs_sign_in', null, null).reason).toBe('the Slack sign-in needs a new token');
    expect(said('forbidden', 'missing_scope')).toEqual({
      reason: "the Slack sign-in 'Slack Airia Bro' lacks a scope to post (chat:write)",
      signIn: true,
    });
    const long = said('needs_sign_in', null, `Bro\n  ${'x'.repeat(100)}`).reason;
    expect(long).toMatch(/^the Slack sign-in 'Bro x+…' needs a new token$/);
    expect(long.length).toBeLessThan(120);
  });

  it('says what Slack did otherwise, no sign-in at fault', () => {
    expect(said('not_in_channel', 'not_in_channel')).toEqual({
      reason: 'the bot is not in this channel: invite it there in Slack (/invite)',
      signIn: false,
    });
    expect(said('rate_limited', 'ratelimited')).toEqual({
      reason: 'Slack was limiting requests',
      signIn: false,
    });
    expect(said('unavailable', 'internal_error')).toEqual({ reason: 'Slack did not answer', signIn: false });
    expect(said('unavailable')).toEqual({ reason: 'Slack did not answer', signIn: false });
    expect(said('not_found', 'channel_not_found')).toEqual({
      reason: 'Slack refused it (channel_not_found)',
      signIn: false,
    });
    expect(said('invalid_response').reason).toBe('Slack refused it (invalid_response)');
    expect(said('forbidden', 'restricted_action').reason).toBe('Slack refused it (restricted_action)');
    expect(said('bad_request', `odd ${'y'.repeat(80)}`).reason).toMatch(/^Slack refused it \(odd y+…\)$/);
  });
});
