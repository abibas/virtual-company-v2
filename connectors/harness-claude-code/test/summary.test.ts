import { describe, expect, it } from 'vitest';
import { denialNotice, resultSummary, resultText, toolSummary } from '../src/summary.ts';

describe('toolSummary', () => {
  it('says what the call does: its command, file, address, query, pattern or task', () => {
    expect(toolSummary({ command: 'ls src', description: 'List the source folder' })).toBe('ls src');
    expect(toolSummary({ file_path: '/w/src/main.ts', old_string: 'a', new_string: 'b' })).toBe(
      '/w/src/main.ts',
    );
    expect(toolSummary({ notebook_path: '/w/a.ipynb' })).toBe('/w/a.ipynb');
    expect(toolSummary({ url: 'https://example.com', prompt: 'summarize' })).toBe('https://example.com');
    expect(toolSummary({ query: 'zod 4 discriminated union' })).toBe('zod 4 discriminated union');
    expect(toolSummary({ pattern: 'TODO', path: 'src' })).toBe('TODO in src');
    expect(toolSummary({ pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(toolSummary({ skill: 'keep-structure' })).toBe('keep-structure');
    expect(toolSummary({ description: 'Find the tests', subagent_type: 'Explore' })).toBe('Find the tests');
    expect(toolSummary({ todos: [{ content: 'a' }, { content: 'b' }] })).toBe('2 to-dos');
  });

  it('falls back to the JSON, skips blank fields, and is empty for no input', () => {
    expect(toolSummary({ command: '  ', issue: 42 })).toBe('{"command":" ","issue":42}');
    expect(toolSummary({})).toBe('');
    expect(toolSummary(undefined)).toBe('');
    expect(toolSummary('ls')).toBe('');
  });

  it('keeps to one line of at most 200 characters', () => {
    const summary = toolSummary({ command: `for f in *; do\n  echo "$f"\ndone ${'x'.repeat(300)}` });
    expect(summary.startsWith('for f in *; do echo "$f" done')).toBe(true);
    expect(summary).toHaveLength(200);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('resultText and resultSummary', () => {
  it('read a string or text blocks, an image as [image]', () => {
    expect(resultText('index.ts\nmain.ts')).toBe('index.ts\nmain.ts');
    expect(
      resultText([
        { type: 'text', text: 'one' },
        { type: 'image', source: {} },
        { type: 'text' },
        'x',
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\n[image]\ntwo');
    expect(resultText(undefined)).toBe('');
    expect(resultText(42)).toBe('');
  });

  it('summarize the start of the result in at most 500 characters', () => {
    expect(resultSummary('  ok  ')).toBe('ok');
    const long = resultSummary(`first line\n${'y'.repeat(1000)}`);
    expect(long).toHaveLength(500);
    expect(long.startsWith('first line\n')).toBe(true);
  });
});

describe('denialNotice', () => {
  it('names the refused tool and what it would have done', () => {
    expect(
      denialNotice({ tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'rm -rf build' } }),
    ).toEqual({
      type: 'notice',
      level: 'warn',
      message: 'Refused for permission: Bash (rm -rf build)',
    });
    expect(denialNotice({ tool_name: 'Write' })?.message).toBe('Refused for permission: Write');
    expect(denialNotice({ tool_input: { file_path: '/etc/hosts' } })?.message).toBe(
      'Refused for permission: A tool (/etc/hosts)',
    );
    expect(denialNotice('Bash')).toBeNull();
  });
});
