/**
 * What a server tool answers (S7.1c, shared by GitHub's since S7.1d): JSON an agent reads, trimmed to what it needs.
 * Empty fields are left out (`compact`), a long text is cut with a note of how much was left out (`cut`), and the whole
 * answer stays under the turn's tool result limit, and under the runner's socket line once it is escaped as JSON and
 * written as UTF-8 (64 KB: a long answer in Cyrillic or full of quotes would pass the characters' limit and not that
 * one).
 */

/** The longest answer: under the tool result's 50 000 characters, with room for its note. */
export const ANSWER_MAX = 48_000;

/** The most bytes an answer takes as a JSON string in UTF-8: under the runner's 64 KB socket line, with room. */
export const ANSWER_BYTES = 56_000;

/** A text cut to `max` characters, saying how many more there were. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[cut: ${text.length - max} more characters]`;
}

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

/** An object without its empty fields. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => !isEmpty(field))) as Partial<T>;
}

/** True when a text fits an answer: its characters, and its bytes as a JSON string. */
const fits = (text: string) =>
  text.length <= ANSWER_MAX && Buffer.byteLength(JSON.stringify(text)) <= ANSWER_BYTES;

/** The answer's text: its JSON, cut to fit (`ANSWER_MAX`, `ANSWER_BYTES`), saying so: ask for less, or a page at a time. */
export function answer(value: unknown): string {
  const text = JSON.stringify(value, null, 1);
  if (fits(text)) return text;
  const note = `\n…[cut: the answer was ${text.length} characters; ask for fewer results or fields]`;
  let keep = Math.min(text.length, ANSWER_MAX);
  while (keep > 0 && !fits(text.slice(0, keep) + note)) keep = Math.floor(keep * 0.9);
  return text.slice(0, keep) + note;
}
