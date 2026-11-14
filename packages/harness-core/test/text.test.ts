import { TOOL_INPUT_MAX, TOOL_OUTPUT_MAX, TRUNCATED_MARKER } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { clipHead, clipLine, clipMarked, clipTail, inputText, outputText } from '../src/text.ts';

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

describe('inputText and outputText (the full trace)', () => {
  it('gives a call’s whole input as indented JSON, a string as it is, nothing for none, and cuts a long one', () => {
    expect(inputText({ command: 'ls', description: 'List' })).toBe(
      '{\n  "command": "ls",\n  "description": "List"\n}',
    );
    expect(inputText('raw arguments')).toBe('raw arguments');
    for (const none of [undefined, null, {}, [], '', '  ']) expect(inputText(none)).toBeUndefined();
    expect(inputText({ file_path: '/w/a.ts' }, '/w/a.ts')).toBeUndefined();
    expect(inputText('ls -la', 'ls -la')).toBeUndefined();
    expect(inputText('git status\ngit diff', 'git status git diff')).toBe('git status\ngit diff');
    expect(inputText({ file_path: '/w/a.ts', limit: 5 }, '/w/a.ts')).toContain('"limit": 5');
    expect(inputText(['a'], 'a')).toBe('[\n  "a"\n]');
    expect(inputText({ limit: 3 }, '{"limit":3}')).toBeUndefined();
    const long = inputText({ text: 'x'.repeat(TOOL_INPUT_MAX) }) as string;
    expect(long).toHaveLength(TOOL_INPUT_MAX);
    expect(long.endsWith(TRUNCATED_MARKER)).toBe(true);
  });

  it('gives a result’s whole text only when its summary cut it, and cuts a long one', () => {
    expect(outputText('short', 10)).toBeUndefined();
    expect(outputText(`  ${'a'.repeat(10)}  `, 10)).toBeUndefined();
    expect(outputText('a'.repeat(11), 10)).toBe('a'.repeat(11));
    const long = outputText('y'.repeat(TOOL_OUTPUT_MAX + 5), 10) as string;
    expect(long).toHaveLength(TOOL_OUTPUT_MAX);
    expect(long.endsWith(TRUNCATED_MARKER)).toBe(true);
  });
});
