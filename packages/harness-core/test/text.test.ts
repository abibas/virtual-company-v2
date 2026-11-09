import { describe, expect, it } from 'vitest';
import { clipHead, clipLine, clipTail } from '../src/text.ts';

describe('clipHead', () => {
  it('keeps a short text, trimmed, and cuts a long one to the limit with an ellipsis', () => {
    expect(clipHead('  short  ', 10)).toBe('short');
    expect(clipHead('abcdefghij', 10)).toBe('abcdefghij');
    expect(clipHead('abcdefghijk', 10)).toBe('abcdefghi…');
    expect(clipHead('abcd efghijk', 6)).toBe('abcd…');
    expect(clipHead('abc', 0)).toBe('');
  });

  it('never splits a character in two', () => {
    const cut = clipHead(`${'a'.repeat(8)}😀😀`, 10);
    expect(cut).toBe(`${'a'.repeat(8)}…`);
    expect(cut.length).toBeLessThanOrEqual(10);
  });
});

describe('clipTail', () => {
  it('keeps the end of a long text, starting with an ellipsis', () => {
    expect(clipTail('  short\n', 10)).toBe('short');
    expect(clipTail('abcdefghijk', 10)).toBe('…cdefghijk');
    expect(clipTail('abcdefg hijk', 6)).toBe('…hijk');
    expect(clipTail('line 1\nline 2\nline 3', 8)).toBe('…line 3');
    expect(clipTail('abc', 0)).toBe('');
  });

  it('never splits a character in two', () => {
    const cut = clipTail(`😀😀${'a'.repeat(8)}`, 10);
    expect(cut).toBe(`…${'a'.repeat(8)}`);
    expect(cut.length).toBeLessThanOrEqual(10);
  });
});

describe('clipLine', () => {
  it('puts the text on one line, then cuts it', () => {
    expect(clipLine('git status\n  && git diff\t--stat', 200)).toBe('git status && git diff --stat');
    expect(clipLine(`a\n${'b'.repeat(300)}`, 200)).toHaveLength(200);
    expect(clipLine(' \n ', 10)).toBe('');
  });
});
