import { describe, expect, it } from 'vitest';
import {
  RECAP_BUDGET,
  RECAP_CUT,
  RECAP_EXCHANGES,
  RECAP_PART_MAX,
  type RecapTurn,
  recapExchanges,
  recapPart,
  recapPrompt,
  sessionLostNotice,
} from '../../../../src/modules/chats/rules/recap.ts';

const turn = (prompt: string, resultText: string | null, fields: Partial<RecapTurn> = {}): RecapTurn => ({
  kind: 'message',
  status: 'done',
  prompt,
  resultText,
  ...fields,
});

describe('recapExchanges', () => {
  it('keeps finished message turns in order, the prompt and the final reply only', () => {
    const turns = [
      turn('/compact', null, { kind: 'compact' }),
      turn('First?', 'One.'),
      turn('/clear', null, { kind: 'clear' }),
      turn('Second?', null, { status: 'failed' }),
      turn('Stopped?', 'Half', { status: 'stopped' }),
      turn('Waiting', null, { status: 'queued' }),
      turn('Running', null, { status: 'running' }),
    ];
    expect(recapExchanges(turns)).toEqual([
      'Person: First?\nYou: One.',
      'Person: Second?\nYou: (no reply)',
      'Person: Stopped?\nYou: Half',
    ]);
    expect(recapExchanges([])).toEqual([]);
  });

  it(`keeps the latest ${RECAP_EXCHANGES} exchanges, then drops the oldest until they fit the budget`, () => {
    const many = Array.from({ length: 30 }, (_, i) => turn(`Q${i}`, `A${i}`));
    const kept = recapExchanges(many);
    expect(kept).toHaveLength(RECAP_EXCHANGES);
    expect(kept[0]).toBe('Person: Q10\nYou: A10');
    expect(kept.at(-1)).toBe('Person: Q29\nYou: A29');
    const big = Array.from({ length: 10 }, (_, i) => turn(`Q${i} ${'p'.repeat(5000)}`, 'r'.repeat(5000)));
    const fitted = recapExchanges(big);
    const size = fitted.reduce((sum, text) => sum + text.length + 2, 0);
    expect(size).toBeLessThanOrEqual(RECAP_BUDGET);
    expect(fitted.at(-1)?.startsWith('Person: Q9 ')).toBe(true);
    expect(fitted.length).toBeLessThan(10);
  });
});

describe('recapPart', () => {
  it('trims, and cuts a long part with a marker', () => {
    expect(recapPart('  short  ')).toBe('short');
    const cut = recapPart('x'.repeat(RECAP_PART_MAX + 10));
    expect(cut).toHaveLength(RECAP_PART_MAX);
    expect(cut.endsWith(RECAP_CUT)).toBe(true);
  });
});

describe('recapPrompt and the notice', () => {
  it('puts the recap before the new message, and is the message alone without one', () => {
    const prompt = recapPrompt(['Person: A?\nYou: B.'], 'C?');
    expect(prompt).toMatch(/^This chat's saved conversation was lost on its machine/);
    expect(prompt).toContain('<recap>\nPerson: A?\nYou: B.\n</recap>');
    expect(prompt.endsWith("The person's new message:\n\nC?")).toBe(true);
    expect(recapPrompt([], 'C?')).toBe('C?');
  });

  it('names the machine, and the recap when there is one', () => {
    expect(sessionLostNotice('Docker runner', true)).toBe(
      'The saved conversation on Docker runner was gone, so this chat started a fresh one with a recap of the last messages.',
    );
    expect(sessionLostNotice('This Mac', false)).toBe(
      'The saved conversation on This Mac was gone, so this chat started a fresh one.',
    );
  });
});
