import { describe, expect, it } from 'vitest';
import { markdownToAdf } from '../../src/adf/from-markdown.ts';
import { adfToMarkdown } from '../../src/adf/to-markdown.ts';

describe('Markdown to ADF', () => {
  it('makes paragraphs with hard breaks, and marks inline text', () => {
    expect(
      markdownToAdf('Hello **world** and _you_,\nsee `x()` ~~not~~ [docs](https://example.com) *now*.')
        .content,
    ).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'you', marks: [{ type: 'em' }] },
          { type: 'text', text: ',' },
          { type: 'hardBreak' },
          { type: 'text', text: 'see ' },
          { type: 'text', text: 'x()', marks: [{ type: 'code' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'not', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'now', marks: [{ type: 'em' }] },
          { type: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('leaves snake_case words and lone stars as they are', () => {
    expect(markdownToAdf('a_b_c and 2 * 3 * 4 and __bold__').content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a_b_c and 2 * 3 * 4 and ' },
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        ],
      },
    ]);
  });

  it('makes headings, code, quotes, lists and rules, and reads back the same', () => {
    const markdown = [
      '## Plan',
      '```ts\nconst x = 1;\n```',
      '> quoted\n> more',
      '- one\n  still one\n- two',
      '3. three\n4. four',
      '1. first',
      '---',
      'end',
    ].join('\n\n');
    const doc = markdownToAdf(markdown);
    expect(doc.content.map((block) => block.type)).toEqual([
      'heading',
      'codeBlock',
      'blockquote',
      'bulletList',
      'orderedList',
      'orderedList',
      'rule',
      'paragraph',
    ]);
    expect(doc.content[4]?.attrs).toEqual({ order: 3 });
    expect(doc.content[5]?.attrs).toBeUndefined();
    expect(adfToMarkdown(doc)).toBe(
      [
        '## Plan',
        '```ts\nconst x = 1;\n```',
        '> quoted\n> more',
        '- one\n  still one\n- two',
        '3. three\n4. four',
        '1. first',
        '---',
        'end',
      ].join('\n\n'),
    );
  });

  it('ends a paragraph at a block, keeps an empty or unclosed code fence, and makes an empty doc of nothing', () => {
    expect(markdownToAdf('text\n# Title').content.map((block) => block.type)).toEqual([
      'paragraph',
      'heading',
    ]);
    expect(markdownToAdf('```\n```').content).toEqual([{ type: 'codeBlock' }]);
    expect(markdownToAdf('```\nopen').content).toEqual([
      { type: 'codeBlock', content: [{ type: 'text', text: 'open' }] },
    ]);
    expect(markdownToAdf('\r\n\r\n')).toEqual({ type: 'doc', version: 1, content: [] });
  });
});
