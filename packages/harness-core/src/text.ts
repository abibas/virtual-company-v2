import { TRUNCATED_MARKER } from '@mwc/shared/harness';

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
