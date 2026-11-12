import { describe, expect, it } from 'vitest';
import { awayError } from '../../../../src/modules/machines/rules/away.ts';

describe('awayError', () => {
  it('names the machine and how long it was away, as the code and its words', () => {
    expect(awayError('Airia devbox', 'grace', 30 * 60_000)).toBe(
      'machine_disconnected: Airia devbox was unreachable for 30 minutes: the turn stopped.',
    );
    expect(awayError('This Mac', 'lost', 1000)).toBe(
      'machine_disconnected: This Mac came back without this turn: it stopped there while the link was down.',
    );
    expect(awayError('Box', 'old_runner', 1000)).toMatch(
      /^machine_disconnected: Box disconnected, and its runner is too old/,
    );
  });

  it('says "The machine" when its name is not known', () => {
    for (const name of [undefined, '  '])
      expect(awayError(name, 'grace', 3_600_000)).toBe(
        'machine_disconnected: The machine was unreachable for 1 hour: the turn stopped.',
      );
  });
});
