import type { ReactNode } from 'react';

/**
 * A name or an email with the typed words marked: each word where it starts a word of the text (else anywhere), any
 * case and without accents, as the server's search matches them.
 */

/** One character's folded form: lower case, accents dropped (é → e). */
const foldChar = (ch: string) => ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The text folded, with the index in `text` each folded character came from. */
function folded(text: string): { readonly folded: string; readonly from: number[] } {
  let out = '';
  const from: number[] = [];
  let at = 0;
  for (const ch of text) {
    for (const part of foldChar(ch)) {
      out += part;
      from.push(at);
    }
    at += ch.length;
  }
  return { folded: out, from };
}

/** Where a word is found in the folded text: at a word's start first, else anywhere; -1 when nowhere. */
function findWord(haystack: string, word: string): number {
  for (let at = haystack.indexOf(word); at !== -1; at = haystack.indexOf(word, at + 1))
    if (at === 0 || /[\s._\-@()/,]/.test(haystack[at - 1] as string)) return at;
  return haystack.indexOf(word);
}

/** The ranges of `text` to mark for the typed words, sorted and merged. */
export function marks(text: string, query: string): [number, number][] {
  const { folded: haystack, from } = folded(text);
  const words = foldChar(query)
    .split(/[\s._\-()/,]+/)
    .filter((word) => word !== '');
  const ranges: [number, number][] = [];
  for (const word of words) {
    const at = findWord(haystack, word);
    if (at === -1) continue;
    const end = at + word.length;
    ranges.push([from[at] as number, end < from.length ? (from[end] as number) : text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** The text with the typed words marked. */
export function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of marks(text, query)) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-[2px] bg-blue-soft text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
