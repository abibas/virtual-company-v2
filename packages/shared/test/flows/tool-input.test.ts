import { describe, expect, it } from 'vitest';
import { checkToolInput, issueLines } from '../../src/flows.ts';

describe('an agents’ tool’s input check', () => {
  it('says each issue on its own line, with where, and names at most ten', () => {
    expect(
      issueLines([
        { path: [], message: 'give one' },
        { path: ['questions', 0, 'options'], message: 'too few' },
      ]),
    ).toBe('give one\nquestions.0.options: too few');
    const many = Array.from({ length: 12 }, (_, i) => ({ path: [`f${i}`], message: 'bad' }));
    expect(issueLines(many).split('\n')).toHaveLength(10);
  });

  it('parses a good input, takes a missing one as empty, and says what to fix in a bad one', () => {
    expect(checkToolInput('task_show', { key: ' T-12 ' })).toEqual({ ok: true, input: { key: 'T-12' } });
    expect(checkToolInput('team_board', null)).toEqual({ ok: true, input: {} });
    const bad = checkToolInput('task_blocked', {});
    expect(bad.ok ? '' : bad.error).toMatch(
      /^task_blocked did nothing; fix its input and call it again:\nreason: /,
    );
  });
});
