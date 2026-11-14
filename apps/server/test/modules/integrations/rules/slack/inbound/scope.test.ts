import { describe, expect, it } from 'vitest';
import {
  addressOf,
  answerPlace,
  joinedRoot,
  pointedRoot,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/scope.ts';

/** Which conversation a Slack message belongs to (2026-11-14): message links, what a message points to, the answer's place. */

const WORKSPACE = 'https://airia.slack.com/';
const LINK = 'https://airia.slack.com/archives/C0GENERAL1/p1731490000000100';

const message = (
  fields: { text?: string; ts?: string; threadTs?: string | null; shared?: string[] } = {},
) => ({
  channel: 'C0GENERAL1',
  ts: '1731490099.000100',
  threadTs: null,
  text: '',
  ...fields,
});

describe('a message’s link', () => {
  it('names its channel, its ts and its thread', () => {
    expect(addressOf(LINK)).toEqual({
      host: 'airia.slack.com',
      channel: 'C0GENERAL1',
      ts: '1731490000.000100',
      root: '1731490000.000100',
    });
    const reply = `${LINK}?thread_ts=1731480000.000200&amp;cid=C0GENERAL1`;
    expect(addressOf(reply)?.root).toBe('1731480000.000200');
    expect(addressOf(`${LINK}?thread_ts=nonsense`)?.root).toBe('1731490000.000100');
    expect(addressOf('https://airia.slack.com/archives/C0GENERAL1')).toBeUndefined();
    expect(addressOf('http://airia.slack.com/archives/C0GENERAL1/p1731490000000100')).toBeUndefined();
    expect(addressOf('https://example.com/x')).toBeUndefined();
  });
});

describe('what a message points to', () => {
  it('is the first message of its channel it links or shares, in its workspace', () => {
    expect(pointedRoot(message({ text: `see <${LINK}|this>` }), WORKSPACE)).toBe('1731490000.000100');
    expect(pointedRoot(message({ text: `see <${LINK}>` }), null)).toBe('1731490000.000100');
    expect(pointedRoot(message({ shared: [LINK] }), WORKSPACE)).toBe('1731490000.000100');
    const other = 'https://airia.slack.com/archives/C0OTHER1/p1731490000000100';
    expect(pointedRoot(message({ text: `<${other}> and <${LINK}>` }), WORKSPACE)).toBe('1731490000.000100');
  });

  it('is nothing for a reply in a thread, a link elsewhere, another workspace, itself, or no link', () => {
    expect(
      pointedRoot(message({ text: `<${LINK}>`, threadTs: '1731480000.000100' }), WORKSPACE),
    ).toBeUndefined();
    const other = 'https://airia.slack.com/archives/C0OTHER1/p1731490000000100';
    expect(pointedRoot(message({ text: `<${other}>` }), WORKSPACE)).toBeUndefined();
    const elsewhere = 'https://other.slack.com/archives/C0GENERAL1/p1731490000000100';
    expect(pointedRoot(message({ text: `<${elsewhere}>` }), WORKSPACE)).toBeUndefined();
    expect(pointedRoot(message({ text: `<${LINK}>` }), 'not an address')).toBe('1731490000.000100');
    expect(pointedRoot(message({ text: `<${LINK}>`, ts: '1731490000.000100' }), WORKSPACE)).toBeUndefined();
    expect(pointedRoot(message({ text: 'plain words <https://example.com>' }), WORKSPACE)).toBeUndefined();
  });

  it('gives the thread a message joins: a reply’s, the pointed one, or none', () => {
    expect(joinedRoot(message({ threadTs: '1731480000.000100' }), WORKSPACE)).toBe('1731480000.000100');
    expect(joinedRoot(message({ text: `<${LINK}>` }), WORKSPACE)).toBe('1731490000.000100');
    expect(joinedRoot(message(), WORKSPACE)).toBeNull();
  });
});

describe('where a turn’s answer goes', () => {
  it('is the thread of the message it answers; nothing without a link', () => {
    expect(answerPlace(LINK)).toEqual({ channel: 'C0GENERAL1', threadTs: '1731490000.000100' });
    expect(answerPlace(`${LINK}?thread_ts=1731480000.000200&cid=C0GENERAL1`)).toEqual({
      channel: 'C0GENERAL1',
      threadTs: '1731480000.000200',
    });
    expect(answerPlace(null)).toBeUndefined();
    expect(answerPlace(undefined)).toBeUndefined();
    expect(answerPlace('https://example.com')).toBeUndefined();
  });
});
