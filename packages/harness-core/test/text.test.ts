import { TRUNCATED_MARKER } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { clipHead, clipLine, clipMarked, clipTail } from '../src/text.ts';

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

describe('clipMarked', () => {
  it('keeps a text that fits as it is, spacing too, and cuts a longer one ending in the marker', () => {
    expect(clipMarked('  a\n b  ', 20)).toBe('  a\n b  ');
    const cut = clipMarked('x'.repeat(50), 30);
    expect(cut).toHaveLength(30);
    expect(cut.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(cut.startsWith('x'.repeat(30 - TRUNCATED_MARKER.length))).toBe(true);
  });

  it('never splits a character in two, and cuts without the marker when there is no room for it', () => {
    const text = `${'a'.repeat(9)}😀${'b'.repeat(40)}`;
    expect(clipMarked(text, 10 + TRUNCATED_MARKER.length)).toBe(`${'a'.repeat(9)}${TRUNCATED_MARKER}`);
    expect(clipMarked('abcdefghijklmnopqrstuvwxyz', 5)).toBe('abcde');
  });
});
