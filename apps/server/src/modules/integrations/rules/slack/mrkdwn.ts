/**
 * Markdown as Slack shows it (T-24, 2026-11-14). Agents write standard Markdown, but a post's `text` is Slack mrkdwn:
 * bold `**x**`/`__x__` → `*x*`, italics `*x*`/`_x_` → `_x_`, strike `~~x~~` → `~x~`, a heading → a bold line, a link
 * `[t](u)` → `<u|t>`, `-`/`*`/`+` list items → `•` (their indent kept; numbered lists stay). Code, inline and fenced,
 * is left as written (a fence loses its language). `&`, `<` and `>` are escaped, except in Slack's own `<…>` tokens
 * (`<@U…>`, `<#C…>`, `<https://…|…>`), the links built here, bare URLs and a quote's leading `>`. Pure.
 */

/** A fence's opening line: its indent, its run of backticks or tildes, and what follows (the language). */
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** A heading line (`## Title`, an optional closing run of `#`). */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
/** A bulleted list item: its indent and its text. */
const ITEM = /^(\s*)[-*+][ \t]+(.*)$/;
/** A thematic break (`---`, `* * *`), kept as written. */
const RULE = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A quote's leading `>` (one or more), kept for Slack. */
const QUOTE = /^((?:[ \t]*>)+[ \t]?)(.*)$/;

/**
 * What inline conversion keeps whole, in order: inline code (1: its backticks, 2: its text), a Markdown link or image
 * (3: its text, 4: its URL), one of Slack's own `<…>` tokens, a bare URL.
 */
const TOKEN = new RegExp(
  [
    /(`+)(.+?)\1(?!`)/.source,
    /!?\[([^\]\n]*)\]\(\s*<?((?:https?:\/\/|mailto:)(?:[^()\s<>]|\([^()\s<>]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/
      .source,
    /<(?:[@#!][^<>\n]+|(?:https?:\/\/|mailto:)[^<>\s|]+(?:\|[^<>\n]*)?)>/.source,
    /\bhttps?:\/\/[^\s<>]+/.source,
  ].join('|'),
  'g',
);

/** The private-use characters this file marks with; taken out of the input first. */
const MARKS = /[-]/g;
/** A kept piece's place in the text. */
const SLOT = /(\d+)/g;
/** A bold star while italics are converted, so `*x*` made from `**x**` is not read as italics again. */
const BOLD = '';

/** `&`, `<` and `>` as Slack requires them outside its control sequences. */
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A bare URL without the punctuation after it (`https://a.b/c).` → `https://a.b/c` and `).`). */
function splitUrl(match: string): [string, string] {
  let url = match;
  for (;;) {
    const last = url.at(-1) ?? '';
    const unbalanced = last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0);
    if (!/[.,;:!?'"*_~]/.test(last) && !unbalanced) break;
    url = url.slice(0, -1);
  }
  return [url, match.slice(url.length)];
}

/** Inline code as Slack shows it: one backtick around it; a span with backticks inside kept as written. */
function code(ticks: string, text: string): string {
  if (ticks.length === 1) return `\`${escaped(text)}\``;
  const inner = text.replace(/^ (.*) $/, '$1');
  return inner.includes('`') ? escaped(`${ticks}${text}${ticks}`) : `\`${escaped(inner)}\``;
}

/** A Markdown link as Slack's `<url|text>` (`<url>` when the text is the URL or empty). */
function link(label: string, url: string): string {
  const href = url.replace(/\|/g, '%7C');
  const text = inline(label.trim());
  return text === '' || label.trim() === url ? `<${href}>` : `<${href}|${text}>`;
}

/** Bold, italics and strike in Slack's marks (`**b**` → `*b*`, `*i*` → `_i_`, `~~s~~` → `~s~`). */
function emphasis(text: string): string {
  return text
    .replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, `${BOLD}_$1_${BOLD}`)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/(^|[^\w])__(?=\S)(.+?)(?<=\S)__(?!\w)/g, `$1${BOLD}$2${BOLD}`)
    .replace(/(^|[^*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g, '$1_$2_')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '~$1~')
    .replaceAll(BOLD, '*');
}

/** One line's inline Markdown as mrkdwn: code, links and Slack's tokens kept whole, the rest converted and escaped. */
function inline(text: string): string {
  const kept: string[] = [];
  const keep = (piece: string) => `${kept.push(piece) - 1}`;
  const marked = text.replace(TOKEN, (match, ticks?: string, body?: string, label?: string, url?: string) => {
    if (ticks !== undefined && body !== undefined) return keep(code(ticks, body));
    if (label !== undefined && url !== undefined) return keep(link(label, url));
    if (match.startsWith('<')) return keep(match);
    const [bare, after] = splitUrl(match);
    return `${keep(bare)}${after}`;
  });
  return escaped(emphasis(marked)).replace(SLOT, (_, index: string) => kept[Number(index)] ?? '');
}

/** One line outside code blocks: a quote's `>` kept, a heading as a bold line, a list item with `•`, then inline. */
function line(text: string): string {
  const quote = QUOTE.exec(text);
  const [prefix, body] = quote === null ? ['', text] : [quote[1] ?? '', quote[2] ?? ''];
  if (RULE.test(body)) return `${prefix}${escaped(body)}`;
  const heading = HEADING.exec(body);
  if (heading !== null) {
    const title = inline((heading[1] ?? '').replace(/\*\*|__/g, '').trim());
    return title === '' ? prefix.trimEnd() : `${prefix}*${title}*`;
  }
  const item = ITEM.exec(body);
  if (item !== null) return `${prefix}${item[1] ?? ''}• ${inline(item[2] ?? '')}`;
  return `${prefix}${inline(body)}`;
}

/** An agent's Markdown as Slack mrkdwn, for a post's `text`. */
export function toMrkdwn(markdown: string): string {
  const out: string[] = [];
  let fence: RegExp | null = null;
  for (const text of markdown.replace(MARKS, '').split('\n')) {
    if (fence !== null) {
      const close = fence.exec(text);
      if (close === null) out.push(escaped(text));
      else {
        out.push(`${close[1] ?? ''}\`\`\``);
        fence = null;
      }
      continue;
    }
    const open = FENCE.exec(text);
    const run = open?.[2] ?? '';
    if (open !== null && !(run.startsWith('`') && (open[3] ?? '').includes('`'))) {
      fence = new RegExp(`^(\\s*)${run[0] === '`' ? '`' : '~'}{${run.length},}\\s*$`);
      out.push(`${open[1] ?? ''}\`\`\``);
      continue;
    }
    out.push(line(text));
  }
  return out.join('\n');
}
