import { describe, expect, it } from 'vitest';
import { frameOf, messageOf, recentIds } from '../../src/socket/frames.ts';

/** Socket Mode's frames read (2026-11-13): hello, disconnect, envelopes and their message events; recent ids. */

describe('a frame', () => {
  it('reads hello, disconnect with its reason, and envelopes', () => {
    expect(frameOf('{"type":"hello"}')).toEqual({ kind: 'hello' });
    expect(frameOf('{"type":"disconnect","reason":"warning"}')).toEqual({
      kind: 'disconnect',
      reason: 'warning',
    });
    expect(frameOf('{"type":"disconnect"}')).toEqual({ kind: 'disconnect', reason: 'unknown' });
    expect(frameOf('{"type":"interactive","envelope_id":"e1"}')).toEqual({
      kind: 'envelope',
      envelopeId: 'e1',
      eventId: null,
      message: null,
    });
    expect(frameOf(Buffer.from('{}'))).toEqual({ kind: 'other' });
    expect(frameOf('{"type":"events_api"}')).toEqual({ kind: 'other' });
  });
});

describe('a message event', () => {
  it('reads a DM’s thread reply, an edit and a bot’s message', () => {
    const payload = {
      event_id: 'Ev1',
      event: {
        type: 'message',
        channel: 'D0DM',
        channel_type: 'im',
        user: 'U0IHOR',
        team: 'T0AIRIA',
        text: 'hi',
        ts: '2.0',
        thread_ts: '1.0',
        edited: { user: 'U0IHOR', ts: '3.0' },
      },
    };
    expect(messageOf(payload)).toMatchObject({
      teamId: 'T0AIRIA',
      channelType: 'im',
      threadTs: '1.0',
      edited: true,
    });
    const bot = { event: { type: 'message', subtype: 'bot_message', bot_id: 'B1', channel: 'C1', ts: '1' } };
    expect(messageOf(bot)).toMatchObject({ botId: 'B1', subtype: 'bot_message', user: null, text: '' });
  });

  it('is none for other events, or without a channel or ts', () => {
    expect(messageOf({ event: { type: 'reaction_added' } })).toBeNull();
    expect(messageOf({ event: { type: 'message', ts: '1' } })).toBeNull();
    expect(messageOf({ event: { type: 'message', channel: 'C1' } })).toBeNull();
    expect(messageOf({})).toBeNull();
  });
});

describe('recent ids', () => {
  it('says an id seen before, forgetting the oldest past the most kept', () => {
    const ids = recentIds(2);
    expect(ids.seen('a')).toBe(false);
    expect(ids.seen('a')).toBe(true);
    expect(ids.seen('b')).toBe(false);
    expect(ids.seen('c')).toBe(false);
    expect(ids.seen('a')).toBe(false);
    expect(ids.seen('c')).toBe(true);
  });
});
