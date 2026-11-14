import { TOOL_INPUT_MAX, TOOL_OUTPUT_MAX, TRUNCATED_MARKER } from '@mwc/shared/harness';

/** Shortening texts for events: summaries keep to their limits without splitting a character in two. */

const ELLIPSIS = '…';

/** The first `n` code units, without a lone high surrogate at the end. */
function headOf(text: string, n: number): string {
  const head = text.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/** The last `n` code units, without a lone low surrogate at the start. */
function tailOf(text: string, n: number): string {
  const tail = text.slice(Math.max(0, text.length - n));
  return /^[\uDC00-\uDFFF]/.test(tail) ? tail.slice(1) : tail;
}

/** The start of `text`, trimmed, at most `max` characters, ending in an ellipsis when cut. */
export function clipHead(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max < 1) return '';
  return `${headOf(trimmed, max - 1).trimEnd()}${ELLIPSIS}`;
}

/** The end of `text` (the last of an output), trimmed, at most `max` characters, starting with an ellipsis when cut. */
export function clipTail(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max < 1) return '';
  return `${ELLIPSIS}${tailOf(trimmed, max - 1).trimStart()}`;
}

/** `text` on one line (every run of whitespace, newlines too, becomes one space), then `clipHead`. */
export function clipLine(text: string, max: number): string {
  return clipHead(text.replace(/\s+/g, ' '), max);
}

/**
 * A long text (thinking, a subagent's answer) at most `max` characters: whole when it fits, else its start ending in
 * `TRUNCATED_MARKER`, so the reader sees there was more. Unlike `clipHead` it keeps the text's own spacing.
 */
export function clipMarked(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= TRUNCATED_MARKER.length) return headOf(text, max);
  return `${headOf(text, max - TRUNCATED_MARKER.length)}${TRUNCATED_MARKER}`;
}

/** The one text an input is: a string, or the one string of an object with one field; undefined otherwise. */
function onlyText(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const values = Object.values(input);
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined;
}

/**
 * A tool call's whole input for the full trace (2026-11-14): a string as it is, anything else as JSON indented by two
 * spaces, cut with the marker at `TOOL_INPUT_MAX`; undefined for no input (none, empty, `{}`) and for one its one-line
 * summary already says whole (a file's path, a short command, its JSON on one line).
 */
export function inputText(input: unknown, summary = ''): string | undefined {
  if (summary !== '' && (onlyText(input) === summary || JSON.stringify(input) === summary)) return undefined;
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? null, null, 2);
  if (text.trim() === '' || text === 'null' || text === '{}' || text === '[]') return undefined;
  return clipMarked(text, TOOL_INPUT_MAX);
}

/**
 * A tool result's whole text for the full trace, beside a summary cut at `summaryMax`: undefined when the summary
 * holds all of it, else the text cut with the marker at `TOOL_OUTPUT_MAX`.
 */
export function outputText(text: string, summaryMax: number): string | undefined {
  return text.trim().length > summaryMax ? clipMarked(text, TOOL_OUTPUT_MAX) : undefined;
}
