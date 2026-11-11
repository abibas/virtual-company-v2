import { describe, expect, it } from 'vitest';
import { boardOrder, inOrder, roundsAt, taskRef } from '../../../src/modules/tasks/rules.ts';

describe('taskRef', () => {
  it('reads a key in any case, or an id', () => {
    expect(taskRef('T-12')).toEqual({ number: 12 });
    expect(taskRef(' t-7 ')).toEqual({ number: 7 });
    expect(taskRef('019A4F0C-8C1E-7C4B-9A52-3D1F2B6E7A10')).toEqual({
      id: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
    });
  });

  it('reads nothing else', () => {
    for (const value of ['T-0', 'T-01', 'T-', '12', 'T-12x', 'X-12', 'T-1234567890', 'not-an-id']) {
      expect(taskRef(value)).toBeUndefined();
    }
  });
});

describe('roundsAt, inOrder and boardOrder', () => {
  it('counts a step never entered as zeros', () => {
    expect(roundsAt({ a: { entries: 2, sendBacks: 1 } }, 'a')).toEqual({ entries: 2, sendBacks: 1 });
    expect(roundsAt({}, 'b')).toEqual({ entries: 0, sendBacks: 0 });
  });

  it('orders steps by position without changing the list', () => {
    const steps = [{ position: 3 }, { position: 1 }, { position: 2 }];
    expect(inOrder(steps).map((s) => s.position)).toEqual([1, 2, 3]);
    expect(steps[0]?.position).toBe(3);
  });

  it('puts the most urgent first, then the oldest', () => {
    const cards = [
      { priority: 'low' as const, number: 1 },
      { priority: 'normal' as const, number: 4 },
      { priority: 'urgent' as const, number: 5 },
      { priority: 'normal' as const, number: 2 },
      { priority: 'high' as const, number: 3 },
    ];
    expect([...cards].sort(boardOrder).map((c) => c.number)).toEqual([5, 3, 2, 4, 1]);
  });
});
