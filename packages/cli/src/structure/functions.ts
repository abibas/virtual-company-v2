/**
 * Named functions in a TypeScript text and where each one ends, for the `long-function` warning of
 * `mwc structure --report`. A heuristic, not a parser: it runs in mwc's own process on every file, with no
 * parser dependency. Biome 2.6.4 has `complexity/noExcessiveLinesPerFunction`, but only inside its own
 * process, where the report could not use it without starting another one, and it counts every callback
 * (each `describe` block of a test). What this sees, and its limits:
 *
 * - function declarations (`function name(`, `export default function (`), functions and arrow functions
 *   assigned to a `const`/`let`/`var` or to an object property (`name: (…) => {`), and methods (`name(…) {`
 *   with `async`, `get`, `set`, `static` and the like); anonymous callbacks (`describe('…', () => {`,
 *   `.map((x) => {`) are not measured, nor arrows with an expression body (`=> value`, `=> ({ … })`);
 * - the parameter list may span up to `MAX_HEADER_LINES` lines; strings and line comments in it are skipped;
 * - it relies on Biome's formatting: the body ends at the first later line that starts with `}` and is
 *   indented no deeper than the header. A multi-line template literal with such a line, or a return type
 *   that spans lines, ends the measure early: an undercount, never a warning too many.
 *
 * A function's length is its first to its last line, both included (blank lines and comments count).
 */
export interface FunctionSpan {
  readonly name: string;
  /** The header's line and the closing brace's line, 1-based. */
  readonly line: number;
  readonly end: number;
}

/** Parameter lists longer than this are not recognized (it bounds the work on a call that is no header). */
export const MAX_HEADER_LINES = 20;

const NAME = '[A-Za-z_$][\\w$]*';
const GENERICS = '(?:<[^(]*>\\s*)?';
const FUNCTION_KEYWORD = `function\\b\\s*\\*?\\s*(?:${NAME}\\s*)?`;

const DECLARATION = new RegExp(
  `^(?:export\\s+)?(default\\s+)?(?:async\\s+)?function\\b\\s*\\*?\\s*(${NAME})?\\s*${GENERICS}\\(`,
);
const ASSIGNED = new RegExp(
  `^(?:export\\s+)?(?:const|let|var)\\s+(${NAME})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(${FUNCTION_KEYWORD})?${GENERICS}\\(`,
);
const PROPERTY = new RegExp(`^(${NAME})\\s*:\\s*(?:async\\s+)?(${FUNCTION_KEYWORD})?${GENERICS}\\(`);
const METHOD = new RegExp(
  `^(?:(?:public|private|protected|static|readonly|override|async|get|set)\\s+)*\\*?\\s*(${NAME})\\s*${GENERICS}\\(`,
);
/** `const f = (async) x => {`: one parameter without parentheses; the body opens on this line. */
const BARE_ARROW = new RegExp(
  `^(?:export\\s+)?(?:const|let|var)\\s+(${NAME})\\s*=\\s*(?:async\\s+)?${NAME}\\s*=>\\s*\\{\\s*$`,
);

/** What follows a header's parameter list when a block body opens on that line. */
const BLOCK_TAIL = /^\s*(?::.*)?\{\s*(?:\/\/.*)?$/;
const ARROW_TAIL = /^\s*(?::.*)?=>\s*\{\s*(?:\/\/.*)?$/;

/** Words that look like a method name before `(` but start a statement or an expression. */
const KEYWORDS = new Set([
  'async',
  'await',
  'case',
  'catch',
  'delete',
  'do',
  'else',
  'for',
  'function',
  'if',
  'import',
  'new',
  'return',
  'super',
  'switch',
  'throw',
  'typeof',
  'void',
  'while',
  'with',
  'yield',
]);

interface Header {
  readonly name: string;
  /** The column of the parameter list's `(` in the trimmed line. */
  readonly open: number;
  readonly arrow: boolean;
}

/** The function header a trimmed line starts, if it starts one. */
export function headerOf(code: string): Header | undefined {
  const declaration = DECLARATION.exec(code);
  if (declaration) {
    const name = declaration[2] ?? (declaration[1] ? 'default' : undefined);
    return name === undefined ? undefined : { name, open: declaration[0].length - 1, arrow: false };
  }
  const assigned = ASSIGNED.exec(code) ?? PROPERTY.exec(code);
  if (assigned) {
    return { name: assigned[1] ?? '', open: assigned[0].length - 1, arrow: assigned[2] === undefined };
  }
  const method = METHOD.exec(code);
  if (method && !KEYWORDS.has(method[1] ?? '')) {
    return { name: method[1] ?? '', open: method[0].length - 1, arrow: false };
  }
  return undefined;
}

/** The index of the quote that closes the string opened at `start`, or -1 when it runs past the line. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let c = start + 1; c < text.length; c++) {
    if (text[c] === '\\') c++;
    else if (text[c] === quote) return c;
  }
  return -1;
}

/** Where the parenthesis opened at `lines[start][col]` closes: its line and the column after it. */
export function closingParen(
  lines: readonly string[],
  start: number,
  col: number,
): { line: number; col: number } | undefined {
  let depth = 0;
  const last = Math.min(lines.length, start + MAX_HEADER_LINES);
  for (let l = start; l < last; l++) {
    const text = lines[l] ?? '';
    for (let c = l === start ? col : 0; c < text.length; c++) {
      const char = text[c];
      if (char === '/' && text[c + 1] === '/') break;
      if (char === "'" || char === '"' || char === '`') {
        c = stringEnd(text, c);
        if (c < 0) break;
      } else if (char === '(') {
        depth++;
      } else if (char === ')' && --depth === 0) {
        return { line: l, col: c + 1 };
      }
    }
  }
  return undefined;
}

/** The line of the brace that closes a body opened on line `open`, by the header's indentation. */
function closingBrace(lines: readonly string[], open: number, indent: number): number | undefined {
  for (let l = open + 1; l < lines.length; l++) {
    const text = lines[l] ?? '';
    const code = text.trimStart();
    if (code.startsWith('}') && text.length - code.length <= indent) return l;
  }
  return undefined;
}

/** Every named function with a block body in a text, in order of its header. */
export function functionSpans(text: string): FunctionSpan[] {
  const lines = text.split('\n');
  const spans: FunctionSpan[] = [];
  lines.forEach((line, index) => {
    const code = line.trimStart();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    const indent = line.length - code.length;
    let body: number | undefined;
    let name: string | undefined;
    const bare = BARE_ARROW.exec(code);
    if (bare) {
      name = bare[1];
      body = index;
    } else {
      const header = headerOf(code);
      const close = header && closingParen(lines, index, indent + header.open);
      if (header && close) {
        const tail = (lines[close.line] ?? '').slice(close.col);
        if ((header.arrow ? ARROW_TAIL : BLOCK_TAIL).test(tail)) {
          name = header.name;
          body = close.line;
        }
      }
    }
    if (name === undefined || body === undefined) return;
    const end = closingBrace(lines, body, indent);
    if (end !== undefined) spans.push({ name, line: index + 1, end: end + 1 });
  });
  return spans;
}
