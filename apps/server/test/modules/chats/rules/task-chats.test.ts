import { describe, expect, it } from 'vitest';
import { roundSpanOf, type StepConversation } from '../../../../src/modules/chats/rules/task-chats.ts';

/** The rounds a task's conversation covers (T-19, `rules/task-chats.ts`), as the task's page counts them. */

const at = (id: string, stepId: string, round: number): StepConversation => ({ id, stepId, round });

describe('roundSpanOf', () => {
  it('a Keep step’s one conversation covers every round the task entered the step', () => {
    const keep = at('a', 'develop', 1);
    expect(roundSpanOf(keep, [keep], 3)).toEqual({ from: 1, to: 3 });
  });

  it('a Fresh step’s conversations cover one round each', () => {
    const first = at('a', 'review', 1);
    const second = at('b', 'review', 2);
    expect(roundSpanOf(first, [first, second], 2)).toEqual({ from: 1, to: 1 });
    expect(roundSpanOf(second, [first, second], 2)).toEqual({ from: 2, to: 2 });
  });

  it('runs up to the round before the step’s next conversation, whatever other steps did', () => {
    const first = at('a', 'develop', 1);
    const review = at('r', 'review', 1);
    const later = at('b', 'develop', 3);
    const all = [first, review, later];
    expect(roundSpanOf(first, all, 4)).toEqual({ from: 1, to: 2 });
    expect(roundSpanOf(later, all, 4)).toEqual({ from: 3, to: 4 });
    expect(roundSpanOf(review, all, 1)).toEqual({ from: 1, to: 1 });
  });

  it('never ends before the round it began in: a new one in the same round, or no entries counted', () => {
    const moved = at('a', 'develop', 1);
    const again = at('b', 'develop', 1);
    expect(roundSpanOf(moved, [moved, again], 1)).toEqual({ from: 1, to: 1 });
    expect(roundSpanOf(again, [moved, again], 1)).toEqual({ from: 1, to: 1 });
    expect(roundSpanOf(at('c', 'develop', 2), [at('c', 'develop', 2)], 0)).toEqual({ from: 2, to: 2 });
  });
});
