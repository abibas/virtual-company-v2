import { type RefObject, useLayoutEffect, useRef } from 'react';

/** How long the place is kept while the inserted turns settle (Markdown and code render after them). */
const SETTLE_MS = 1500;
/** How long a hold waits for its turns before it lapses (a failed or dropped page inserts none). */
const LAPSE_MS = 15_000;
const READER_MOVES = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Keeps the reader's place in a scrolling box while older turns go in above (no jump): `hold()` before the load notes
 * how far from the bottom the view is; when the first turn changes, the view goes back to that distance, and stays
 * there while the content still grows, until the reader scrolls or a moment passes. The browser's own scroll anchoring
 * is off on the box (`overflow-anchor: none`), so the two never fight.
 */
export function useKeepScroll(
  box: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  first: string | undefined,
): () => void {
  const fromBottom = useRef<number | undefined>(undefined);
  const lapse = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first turn is what moves the content.
  useLayoutEffect(() => {
    const element = box.current;
    const distance = fromBottom.current;
    if (element === null || distance === undefined) return;
    fromBottom.current = undefined;
    clearTimeout(lapse.current);
    const keep = () => {
      element.scrollTop = element.scrollHeight - distance;
    };
    keep();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(keep);
    if (content.current) observer?.observe(content.current);
    const release = () => {
      observer?.disconnect();
      clearTimeout(timer);
      for (const name of READER_MOVES) element.removeEventListener(name, release);
    };
    const timer = setTimeout(release, SETTLE_MS);
    for (const name of READER_MOVES) element.addEventListener(name, release, { passive: true });
    return release;
  }, [first]);
  return () => {
    const element = box.current;
    if (element === null) return;
    fromBottom.current = element.scrollHeight - element.scrollTop;
    clearTimeout(lapse.current);
    lapse.current = setTimeout(() => {
      fromBottom.current = undefined;
    }, LAPSE_MS);
  };
}
