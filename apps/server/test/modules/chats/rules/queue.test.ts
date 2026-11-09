import { describe, expect, it } from 'vitest';
import {
  NOW_CODEX,
  NOW_COMPACT,
  nextQueued,
  nowRefusal,
  QUEUE_FULL,
  startSeq,
} from '../../../../src/modules/chats/rules/queue.ts';

describe('the chats’ queue rules', () => {
  it('let only a Claude Code message turn take a message now', () => {
    expect(nowRefusal({ harness: 'claude_code' }, { kind: 'message' })).toBeUndefined();
    expect(nowRefusal({ harness: 'claude_code' }, { kind: 'compact' })).toBe(NOW_COMPACT);
    expect(nowRefusal({ harness: 'codex' }, { kind: 'message' })).toBe(NOW_CODEX);
    expect(QUEUE_FULL).toMatchObject({ status: 409, code: 'queue_full' });
    expect(QUEUE_FULL.message).toContain('10 messages');
  });

  it('start a Now or interrupting message first, then the rest, oldest first', () => {
    expect(nextQueued([])).toBeUndefined();
    const queue = [
      { id: 'a', delivery: 'after', seq: 2 },
      { id: 'b', delivery: 'interrupt', seq: 4 },
      { id: 'c', delivery: 'now', seq: 3 },
    ] as const;
    expect(nextQueued(queue)?.id).toBe('c');
    expect(nextQueued([queue[0]])?.id).toBe('a');
  });

  it('number a starting turn after every turn that started before it', () => {
    expect(startSeq(2, 1, 3)).toBe(2);
    expect(startSeq(2, 3, 3)).toBe(4);
    expect(startSeq(1, 0, 1)).toBe(1);
  });
});
