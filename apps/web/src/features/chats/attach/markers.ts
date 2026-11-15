/**
 * The `[Image N]` markers of the message being written (T-20): where a dropped or pasted image belongs in its text, as
 * Claude Code's own terminal writes them. A marker is one unit: an edit that cuts into one takes all of it, and text
 * typed inside one goes in after it. At send the markers are numbered 1, 2, … in the order they appear, the order the
 * images go to the agent in. Pure.
 */

const MARKER = /\[Image (\d+)\]/g;

export const markerOf = (n: number): string => `[Image ${n}]`;

/** A marker in the text: its number and where it stands. */
export interface MarkerSpan {
  readonly n: number;
  readonly start: number;
  readonly end: number;
}

export function markersIn(text: string): MarkerSpan[] {
  return [...text.matchAll(MARKER)].map((match) => ({
    n: Number(match[1]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** The numbers of the markers in the text, each once, in the order they first appear. */
export const markerOrder = (text: string): number[] => [
  ...new Set(markersIn(text).map((marker) => marker.n)),
];

/** True for a text of markers alone (the thread shows the images without a bubble). */
export const isMarkersOnly = (text: string): boolean => /^\s*(\[Image \d+\]\s*)+$/.test(text);

/** Punctuation that sits right after a word, so no space goes before it. */
const CLOSES = /^[\s,.;:!?)]/;

/** The markers of `numbers` put in over the selection, a space from their neighbours; the caret after them. */
export function insertMarkers(
  text: string,
  start: number,
  end: number,
  numbers: readonly number[],
): { readonly text: string; readonly caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const trail = CLOSES.test(after) ? '' : ' ';
  const put = `${lead}${numbers.map(markerOf).join(' ')}${trail}`;
  return { text: `${before}${put}${after}`, caret: before.length + put.length };
}

/** `text` without `[start, end)`, and one space of its neighbours with it so no gap of two is left. */
function cutOut(text: string, start: number, end: number) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  let from = start;
  let to = end;
  if (after.startsWith(' ') && (before === '' || /\s$/.test(before))) to += 1;
  else if (before.endsWith(' ') && (after === '' || CLOSES.test(after))) from -= 1;
  return { text: `${text.slice(0, from)}${text.slice(to)}`, from, to };
}

/** The text without the marker of `n` (each time it stands), and where the caret at `caret` goes. */
export function withoutMarker(
  text: string,
  n: number,
  caret = text.length,
): { readonly text: string; readonly caret: number } {
  const marker = markerOf(n);
  let out = text;
  let at = caret;
  for (let found = out.indexOf(marker); found !== -1; found = out.indexOf(marker)) {
    const cut = cutOut(out, found, found + marker.length);
    if (at >= cut.to) at -= cut.to - cut.from;
    else if (at > cut.from) at = cut.from;
    out = cut.text;
  }
  return { text: out, caret: at };
}

/** An edit as one splice of the text before it: `[start, end)` replaced by `inserted`. */
function spliceOf(before: string, after: string) {
  const most = Math.min(before.length, after.length);
  let start = 0;
  while (start < most && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < most - start && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail += 1;
  return { start, end: before.length - tail, inserted: after.slice(start, after.length - tail) };
}

/**
 * An edit of the text with its markers kept whole: one that cuts into a marker takes all of it (a Backspace after its
 * `]` removes the marker), one typed inside a marker goes in after it. The text and the caret; undefined when the edit
 * touches no marker and stands as it is.
 */
export function keepMarkersWhole(
  before: string,
  after: string,
): { readonly text: string; readonly caret: number } | undefined {
  const { start, end, inserted } = spliceOf(before, after);
  const markers = markersIn(before);
  if (start === end) {
    const inside = markers.find((marker) => marker.start < start && start < marker.end);
    if (inside === undefined) return undefined;
    const text = `${before.slice(0, inside.end)}${inserted}${before.slice(inside.end)}`;
    return { text, caret: inside.end + inserted.length };
  }
  const cut = markers.filter(
    (marker) => marker.start < end && start < marker.end && (marker.start < start || end < marker.end),
  );
  if (cut.length === 0) return undefined;
  const from = Math.min(start, ...cut.map((marker) => marker.start));
  const to = Math.max(end, ...cut.map((marker) => marker.end));
  if (inserted === '') {
    const out = cutOut(before, from, to);
    return { text: out.text, caret: out.from };
  }
  return { text: `${before.slice(0, from)}${inserted}${before.slice(to)}`, caret: from + inserted.length };
}

/** The text with the markers of `numbers` numbered 1, 2, … in that order; any other marker as it is. */
export function renumbered(text: string, numbers: readonly number[]): string {
  const next = new Map(numbers.map((n, index) => [n, index + 1]));
  return text.replace(MARKER, (marker, n: string) => {
    const to = next.get(Number(n));
    return to === undefined ? marker : markerOf(to);
  });
}
