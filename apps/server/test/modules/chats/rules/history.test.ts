import { describe, expect, it } from 'vitest';
import { conversationsBefore } from '../../../../src/modules/chats/rules/history.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 9, minute));

describe('conversationsBefore', () => {
  it('describes the conversation each Clear ended, newest first; one without a turn is empty', () => {
    const clears = [
      { id: 'c1', seq: 3, createdAt: at(3) },
      { id: 'c2', seq: 4, createdAt: at(4) },
    ];
    expect(conversationsBefore(clears, [{ index: 0, turns: 2, from: at(1), to: at(2) }])).toEqual([
      { clearTurnId: 'c2', clearSeq: 4, clearedAt: at(4).toISOString(), turns: 0, from: null, to: null },
      {
        clearTurnId: 'c1',
        clearSeq: 3,
        clearedAt: at(3).toISOString(),
        turns: 2,
        from: at(1).toISOString(),
        to: at(2).toISOString(),
      },
    ]);
  });

  it('is empty without a Clear', () => {
    expect(conversationsBefore([], [])).toEqual([]);
  });
});
