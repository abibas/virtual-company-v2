import { describe, expect, it } from 'vitest';
import { adfToMarkdown } from '../../src/adf/to-markdown.ts';

const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]) => ({ type: 'doc', version: 1, content });

describe('ADF to Markdown', () => {
  it('gives paragraphs, headings and marked text as Markdown', () => {
    const body = doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('Steps')] },
      p(
        t('bold', [{ type: 'strong' }]),
        t(' '),
        t('it', [{ type: 'em' }]),
        t(' '),
        t('x()', [{ type: 'code' }]),
        t(' '),
        t('gone', [{ type: 'strike' }]),
        t(' '),
        t('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      ),
      p(t('one'), { type: 'hardBreak' }, t('two')),
      p(),
    );
    expect(adfToMarkdown(body)).toBe(
      '## Steps\n\n**bold** _it_ `x()` ~~gone~~ [site](https://example.com)\n\none\ntwo',
    );
  });

  it('gives lists (nested, numbered from their start, tasks), code, quotes, panels and rules', () => {
    const item = (...content: object[]) => ({ type: 'listItem', content });
    const body = doc(
      {
        type: 'bulletList',
        content: [item(p(t('a')), { type: 'bulletList', content: [item(p(t('a1')))] }), item(p(t('b')))],
      },
      { type: 'orderedList', attrs: { order: 3 }, content: [item(p(t('c'))), item(p(t('d')))] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'DONE' }, content: [t('done')] },
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('todo')] },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('let x = 1;')] },
      { type: 'blockquote', content: [p(t('quoted')), p(t('more'))] },
      { type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('careful'))] },
      { type: 'rule' },
    );
    expect(adfToMarkdown(body)).toBe(
      [
        '- a\n  - a1\n- b',
        '3. c\n4. d',
        '- [x] done\n- [ ] todo',
        '```ts\nlet x = 1;\n```',
        '> quoted\n>\n> more',
        '> **warning:** careful',
        '---',
      ].join('\n\n'),
    );
  });

  it('gives tables, mentions, cards, dates, statuses, attachments, macros and expands in words', () => {
    const cell = (type: string, text: string) => ({ type, content: [p(t(text))] });
    const body = doc(
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Value')] },
          { type: 'tableRow', content: [cell('tableCell', 'a|b')] },
        ],
      },
      p(
        { type: 'mention', attrs: { id: 'u-1', text: '@Ihor' } },
        t(' '),
        { type: 'mention', attrs: { id: 'u-2', text: 'QA' } },
        t(' '),
        { type: 'emoji', attrs: { shortName: ':tada:' } },
        t(' '),
        { type: 'inlineCard', attrs: { url: 'https://acme.atlassian.net/browse/AP-1' } },
        t(' '),
        { type: 'date', attrs: { timestamp: '1762992000000' } },
        t(' '),
        { type: 'status', attrs: { text: 'DONE' } },
      ),
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm-1', alt: 'shot.png' } }] },
      { type: 'extension', attrs: { extensionKey: 'toc' } },
      { type: 'expand', attrs: { title: 'More' }, content: [p(t('hidden'))] },
      { type: 'blockCard', attrs: { url: 'https://example.com/x' } },
      { type: 'unknownBlock', content: [p(t('kept'))] },
      { type: 'unknownInline', content: [t('also kept')] },
    );
    expect(adfToMarkdown(body)).toBe(
      [
        '| Name | Value |\n| --- | --- |\n| a\\|b |  |',
        '@Ihor @QA :tada: https://acme.atlassian.net/browse/AP-1 2025-11-13 [DONE]',
        '[attachment: shot.png]',
        '[macro: toc]',
        '**More**\n\nhidden',
        'https://example.com/x',
        'kept',
        'also kept',
      ].join('\n\n'),
    );
  });

  it('takes a string as it is, and gives nothing for what is no ADF', () => {
    expect(adfToMarkdown('plain')).toBe('plain');
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown({ content: [] })).toBe('');
    expect(adfToMarkdown(p(t('a block alone')))).toBe('a block alone');
    expect(adfToMarkdown(doc({ type: 'table', content: [] }))).toBe('');
  });
});
