import { describe, expect, it } from 'vitest';
import { toMrkdwn } from '../../../../../src/modules/integrations/rules/slack/mrkdwn.ts';

/**
 * An agent's Markdown as Slack mrkdwn (T-24, docs/subscriptions.md "Markdown in Slack"): emphasis in Slack's marks,
 * headings as bold lines, links as `<url|text>`, bullets as `•`, code left as written, `&`, `<` and `>` escaped outside
 * Slack's own tokens, quotes and breaks kept.
 */

/** Each input line by line, as Slack gets it. */
const each = (lines: readonly string[]) => lines.map(toMrkdwn);

describe('emphasis', () => {
  it('turns bold into one star, italics into underscores, both into both, and strike into one tilde', () => {
    expect(
      each([
        '**bold** and __bold__',
        '*it* and _it_',
        '***both***',
        '~~gone~~',
        '**bold** and *it*',
        '**a *b* c**',
        '**a** **b**',
        '__init__',
      ]),
    ).toEqual([
      '*bold* and *bold*',
      '_it_ and _it_',
      '*_both_*',
      '~gone~',
      '*bold* and _it_',
      '*a _b_ c*',
      '*a* *b*',
      '*init*',
    ]);
  });

  it('leaves marks that open or close on a space, inside a word, or alone', () => {
    expect(
      each(['a * b * c', '2*3*4', 'snake_case_word', 'x__y__z', '*a*b', 'a*b*', '** x **', '~~ x ~~']),
    ).toEqual(['a * b * c', '2*3*4', 'snake_case_word', 'x__y__z', '*a*b', 'a*b*', '** x **', '~~ x ~~']);
  });
});

describe('a heading', () => {
  it('is a bold line at any level, without its closing #s or its own bold marks', () => {
    expect(
      each([
        '# One',
        '### Three ###',
        '## Title #',
        '   ## Indented',
        '#\tTab',
        '## a#b',
        '## **Bold** title',
        '## __x__ y',
        '## See [docs](https://a.b)',
        '> # In a quote',
      ]),
    ).toEqual([
      '*One*',
      '*Three*',
      '*Title*',
      '*Indented*',
      '*Tab*',
      '*a#b*',
      '*Bold title*',
      '*x y*',
      '*See <https://a.b|docs>*',
      '> *In a quote*',
    ]);
  });

  it('with no title is dropped, a quote keeping its >', () => {
    expect(each(['#', '## ', '> #'])).toEqual(['', '', '>']);
  });

  it('needs one to six #s, a space after them and at most three spaces before', () => {
    expect(each(['####### seven', '#nospace', '    # four spaces'])).toEqual([
      '####### seven',
      '#nospace',
      '    # four spaces',
    ]);
  });
});

describe('a link or an image', () => {
  it("is Slack's <url|text>, its text converted and escaped, its title dropped", () => {
    expect(
      each([
        '[text](https://a.b/c)',
        '![alt](https://a.b/i.png)',
        '[t](mailto:a@b.c)',
        '[t](<https://a.b/c>)',
        '[t]( https://a.b )',
        '[t](https://a.b "Title")',
        "[t](https://a.b 'Title')",
        '[x **b**](https://a.b)',
        '[a & b](https://x.y)',
        '[t](https://a.b/(x))',
        '[t](https://a.b/?x=1&y=2)',
        '[a](https://a.b) and [b](https://c.d)',
      ]),
    ).toEqual([
      '<https://a.b/c|text>',
      '<https://a.b/i.png|alt>',
      '<mailto:a@b.c|t>',
      '<https://a.b/c|t>',
      '<https://a.b|t>',
      '<https://a.b|t>',
      '<https://a.b|t>',
      '<https://a.b|x *b*>',
      '<https://x.y|a &amp; b>',
      '<https://a.b/(x)|t>',
      '<https://a.b/?x=1&y=2|t>',
      '<https://a.b|a> and <https://c.d|b>',
    ]);
  });

  it('is <url> alone when its text is empty or the URL itself', () => {
    expect(
      each([
        '[](https://a.b/c)',
        '[ ](https://a.b)',
        '![](https://a.b/i.png)',
        '[https://a.b/c](https://a.b/c)',
        '[ https://a.b/c ](https://a.b/c)',
      ]),
    ).toEqual([
      '<https://a.b/c>',
      '<https://a.b>',
      '<https://a.b/i.png>',
      '<https://a.b/c>',
      '<https://a.b/c>',
    ]);
  });

  it('escapes a | in its URL, which would end it early in Slack', () => {
    expect(toMrkdwn('[t](https://a.b/c|d)')).toBe('<https://a.b/c%7Cd|t>');
  });

  it('is left as written for a scheme other than http(s) or mailto', () => {
    expect(toMrkdwn('[t](ftp://x)')).toBe('[t](ftp://x)');
  });
});

describe('a list', () => {
  it('has its -, * and + items as •, their indent kept and their text converted', () => {
    expect(each(['- one', '  * two', '+ three', '\t+ tab', '    - deep', '- **b** & c'])).toEqual([
      '• one',
      '  • two',
      '• three',
      '\t• tab',
      '    • deep',
      '• *b* &amp; c',
    ]);
  });

  it('keeps a numbered list as written, and a dash without a space is no item', () => {
    expect(each(['1. first', '2) second', '1. a < b', '-not'])).toEqual([
      '1. first',
      '2) second',
      '1. a &lt; b',
      '-not',
    ]);
  });
});

describe('inline code', () => {
  it('is left as written in one backtick, its text escaped and never converted', () => {
    expect(each(['`a < b`', '`**not bold**`', 'use `x & y` here', '`` a ``', '```x```'])).toEqual([
      '`a &lt; b`',
      '`**not bold**`',
      'use `x &amp; y` here',
      '`a`',
      '`x`',
    ]);
  });

  it('with backticks inside is kept with its own backticks', () => {
    expect(each(['``a ` b``', '``a ` <b``'])).toEqual(['``a ` b``', '``a ` &lt;b``']);
  });
});

describe('a fenced block', () => {
  it('loses its language, keeps its indent and its text as written but escaped', () => {
    expect(toMrkdwn('```js\nconst a = 1 < 2 && b;\n**x**\n```')).toBe(
      '```\nconst a = 1 &lt; 2 &amp;&amp; b;\n**x**\n```',
    );
    expect(toMrkdwn('```ts title="a"\nx\n```')).toBe('```\nx\n```');
    expect(toMrkdwn('``` \nx\n```   ')).toBe('```\nx\n```');
    expect(toMrkdwn('  ```\n  code\n  ```')).toBe('  ```\n  code\n  ```');
    expect(toMrkdwn('before **b**\n```\n**x**\n```\nafter **b**')).toBe(
      'before *b*\n```\n**x**\n```\nafter *b*',
    );
  });

  it('may open with tildes, and closes only on a run as long of the same mark, alone on its line', () => {
    expect(toMrkdwn('~~~\n<x>\n~~~')).toBe('```\n&lt;x&gt;\n```');
    expect(toMrkdwn('````\n```\n````')).toBe('```\n```\n```');
    expect(toMrkdwn('~~~~\n~~~\n~~~~')).toBe('```\n~~~\n```');
    expect(toMrkdwn('~~~\n```\n~~~')).toBe('```\n```\n```');
    expect(toMrkdwn('```\nx\n```js\n```')).toBe('```\nx\n```js\n```');
  });

  it('runs to the end when it is never closed', () => {
    expect(toMrkdwn('```\n**x**\n- y < z')).toBe('```\n**x**\n- y &lt; z');
  });

  it('is no fence when a backtick run is followed by a backtick on its line', () => {
    expect(toMrkdwn('```a`b\n**bold**')).toBe('```a`b\n*bold*');
  });
});

describe('escaping', () => {
  it('escapes &, < and > outside Slack’s tokens, an entity too', () => {
    expect(each(['a & b < c > d', '&amp;', '<notatoken>', '< @U1>'])).toEqual([
      'a &amp; b &lt; c &gt; d',
      '&amp;amp;',
      '&lt;notatoken&gt;',
      '&lt; @U1&gt;',
    ]);
  });

  it('keeps Slack’s own mentions, channels, specials and links whole', () => {
    const tokens =
      '<@U1> hi <#C1|general> <!here> <!subteam^S1> <@U2|ihor> <https://x.y|y & z> <mailto:a@b.c>';
    expect(toMrkdwn(tokens)).toBe(tokens);
    expect(each(['<https://x.y>', '<http://x.y|a|b>'])).toEqual(['<https://x.y>', '<http://x.y|a|b>']);
  });
});

describe('a bare URL', () => {
  it('is kept whole, its & unescaped and its marks unconverted', () => {
    expect(each(['https://a.b/c?x=1&y=2', 'see https://a.b/**x**', 'http://a.b/_c_'])).toEqual([
      'https://a.b/c?x=1&y=2',
      'see https://a.b/**x**',
      'http://a.b/_c_',
    ]);
  });

  it('leaves the punctuation after it, and a closing parenthesis it did not open, outside', () => {
    expect(
      each([
        '**see https://a.b/c**',
        '*see https://a.b/c*',
        '*(https://a.b/c)*',
        '*https://w.org/Foo_(bar)*',
        'go to https://a.b/c, then https://d.e/f. Done',
        'https://en.wikipedia.org/wiki/Foo_(bar)',
      ]),
    ).toEqual([
      '*see https://a.b/c*',
      '_see https://a.b/c_',
      '_(https://a.b/c)_',
      '_https://w.org/Foo_(bar)_',
      'go to https://a.b/c, then https://d.e/f. Done',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });
});

describe('a quote and a break', () => {
  it('keeps a quote’s leading >, nested too, and converts what follows', () => {
    expect(
      each(['> quoted **b**', '>> nested', '> > nested', '> - item', '> a < b', '>x', '>', '  > indented']),
    ).toEqual([
      '> quoted *b*',
      '>> nested',
      '> > nested',
      '> • item',
      '> a &lt; b',
      '>x',
      '>',
      '  > indented',
    ]);
    expect(toMrkdwn('a > b')).toBe('a &gt; b');
  });

  it('keeps a thematic break as written, in a quote too', () => {
    expect(each(['---', '***', '* * *', '___', '- - -', '> ---'])).toEqual([
      '---',
      '***',
      '* * *',
      '___',
      '- - -',
      '> ---',
    ]);
  });

  it('keeps the lines, empty ones too', () => {
    expect(toMrkdwn('line1\n\nline2')).toBe('line1\n\nline2');
    expect(toMrkdwn('')).toBe('');
  });
});

describe('the private-use marks', () => {
  it('are taken out of the input, so text cannot pose as a kept piece or a bold star', () => {
    expect(toMrkdwn('`code` 0')).toBe('`code` 0');
    expect(toMrkdwn('ab*c*')).toBe('ab*c*');
    expect(toMrkdwn('xy *i*')).toBe('xy _i_');
  });
});
