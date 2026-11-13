/**
 * Markdown to Atlassian Document Format (S7.1c): what an agent writes (a comment, a description, a page in Markdown)
 * as Jira and Confluence take it. Blocks: paragraphs (a single line break inside one is a hard break), `#` headings,
 * fenced code, `>` quotes, `-`/`*`/`+` and numbered lists (one level), and `---` rules. Inline: `code`, **bold**,
 * _italics_, ~~strike-through~~ and [links](https://…), not nested. Anything else is plain text, never lost.
 */

export interface AdfMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface AdfBlock {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly (AdfBlock | AdfText)[];
}

export interface AdfText {
  readonly type: 'text' | 'hardBreak';
  readonly text?: string;
  readonly marks?: readonly AdfMark[];
}

export interface AdfDoc {
  readonly type: 'doc';
  readonly version: 1;
  readonly content: readonly AdfBlock[];
}

/** Inline Markdown, each kind its own group: code, bold, strike, link, italics. */
const INLINE =
  /(`[^`\n]+`)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(?<!\w)\*([^*\s][^*\n]*)\*(?!\w)|(?<!\w)_([^_\s][^_\n]*)_(?!\w)/g;

const text = (value: string, marks?: readonly AdfMark[]): AdfText =>
  marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks };

/** One line's inline Markdown as ADF text nodes; no empty text node. */
function inlineLine(line: string): AdfText[] {
  const out: AdfText[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text(line.slice(last, at)));
    const [, code, bold, boldU, strike, label, href, em, emU] = match;
    if (code !== undefined) out.push(text(code.slice(1, -1), [{ type: 'code' }]));
    else if (bold !== undefined || boldU !== undefined)
      out.push(text((bold ?? boldU) as string, [{ type: 'strong' }]));
    else if (strike !== undefined) out.push(text(strike, [{ type: 'strike' }]));
    else if (label !== undefined) out.push(text(label, [{ type: 'link', attrs: { href } }]));
    else out.push(text((em ?? emU) as string, [{ type: 'em' }]));
    last = at + match[0].length;
  }
  if (last < line.length) out.push(text(line.slice(last)));
  return out;
}

/** Lines as one paragraph's inline content, a hard break between them. */
function inlineOf(lines: readonly string[]): AdfText[] {
  const out: AdfText[] = [];
  lines.forEach((line, index) => {
    if (index > 0) out.push({ type: 'hardBreak' });
    out.push(...inlineLine(line));
  });
  return out;
}

const paragraph = (lines: readonly string[]): AdfBlock => ({ type: 'paragraph', content: inlineOf(lines) });

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;

/** True for a line that starts a block of its own (so it ends a paragraph). */
const startsBlock = (line: string) =>
  [HEADING, FENCE, RULE, QUOTE, BULLET, NUMBERED].some((pattern) => pattern.test(line));

/** A list's items from `lines` at `start` matching `pattern` (a following indented line continues an item). */
function listAt(lines: readonly string[], start: number, pattern: RegExp) {
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] as string;
    const item = pattern.exec(line);
    if (item) items.push([item[item.length - 1] as string]);
    else if (/^\s{2,}\S/.test(line) && items.length > 0) items.at(-1)?.push(line.trim());
    else break;
    i++;
  }
  const content = items.map((item) => ({ type: 'listItem', content: [paragraph(item)] }));
  return { content, next: i };
}

/** The block that starts at line `i`, and the line after it. */
function blockAt(lines: readonly string[], i: number): { block: AdfBlock; next: number } {
  const line = lines[i] as string;
  const fence = FENCE.exec(line);
  if (fence) {
    let end = i + 1;
    while (end < lines.length && !FENCE.test(lines[end] as string)) end++;
    const code = lines.slice(i + 1, end).join('\n');
    const attrs = fence[1] ? { language: fence[1] } : undefined;
    const block = {
      type: 'codeBlock',
      ...(attrs ? { attrs } : {}),
      ...(code ? { content: [text(code)] } : {}),
    };
    return { block, next: end + 1 };
  }
  const heading = HEADING.exec(line);
  if (heading) {
    const level = (heading[1] as string).length;
    return {
      block: { type: 'heading', attrs: { level }, content: inlineLine(heading[2] as string) },
      next: i + 1,
    };
  }
  if (RULE.test(line)) return { block: { type: 'rule' }, next: i + 1 };
  if (QUOTE.test(line)) {
    let end = i;
    while (end < lines.length && QUOTE.test(lines[end] as string)) end++;
    const inner = lines.slice(i, end).map((quote) => (QUOTE.exec(quote) as RegExpExecArray)[1] as string);
    return { block: { type: 'blockquote', content: parse(inner) }, next: end };
  }
  const numbered = NUMBERED.exec(line);
  if (BULLET.test(line) || numbered) {
    const { content, next } = listAt(lines, i, numbered ? NUMBERED : BULLET);
    const order = numbered ? Number(numbered[1]) : 1;
    const block = numbered
      ? { type: 'orderedList', ...(order === 1 ? {} : { attrs: { order } }), content }
      : { type: 'bulletList', content };
    return { block, next };
  }
  let end = i + 1;
  while (end < lines.length && (lines[end] as string).trim() !== '' && !startsBlock(lines[end] as string))
    end++;
  return { block: paragraph(lines.slice(i, end)), next: end };
}

/** Lines as ADF blocks; blank lines only separate. */
function parse(lines: readonly string[]): AdfBlock[] {
  const out: AdfBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] as string).trim() === '') {
      i++;
      continue;
    }
    const { block, next } = blockAt(lines, i);
    out.push(block);
    i = next;
  }
  return out;
}

/** Markdown as an ADF document (see above). */
export function markdownToAdf(markdown: string): AdfDoc {
  return { type: 'doc', version: 1, content: parse(markdown.replace(/\r\n?/g, '\n').split('\n')) };
}
