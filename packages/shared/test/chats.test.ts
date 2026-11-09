import { describe, expect, it } from 'vitest';
import { CHAT_PROMPT, CHAT_TITLE, chatEventId, isAfter, parseChatEventId } from '../src/chats.ts';

describe('chats', () => {
  it('hold a title to 80 characters and a prompt to 20 000', () => {
    expect(CHAT_TITLE.max).toBe(80);
    expect(CHAT_PROMPT.max).toBe(20_000);
  });

  it('write and read an event id as <turn>.<event>', () => {
    expect(chatEventId({ turnSeq: 3, eventSeq: 17 })).toBe('3.17');
    expect(parseChatEventId('3.17')).toEqual({ turnSeq: 3, eventSeq: 17 });
    expect(parseChatEventId(' 2.0 ')).toEqual({ turnSeq: 2, eventSeq: 0 });
    for (const bad of [undefined, '', '0.1', '1', '1.', 'a.b', '01.2', '1.02', '1.2.3', '-1.2']) {
      expect(parseChatEventId(bad)).toBeUndefined();
    }
  });

  it('order events by turn, then by event', () => {
    expect(isAfter({ turnSeq: 2, eventSeq: 1 }, { turnSeq: 1, eventSeq: 9 })).toBe(true);
    expect(isAfter({ turnSeq: 1, eventSeq: 3 }, { turnSeq: 1, eventSeq: 2 })).toBe(true);
    expect(isAfter({ turnSeq: 1, eventSeq: 2 }, { turnSeq: 1, eventSeq: 2 })).toBe(false);
    expect(isAfter({ turnSeq: 1, eventSeq: 9 }, { turnSeq: 2, eventSeq: 0 })).toBe(false);
  });
});
