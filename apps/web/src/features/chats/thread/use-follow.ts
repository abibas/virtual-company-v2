import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How close to the bottom counts as reading the latest: the thread follows new output only then. */
const FOLLOW_PX = 96;

function toEnd(element: HTMLElement | null) {
  if (element) element.scrollTop = element.scrollHeight;
}

/**
 * Keeps a scrolling box at its bottom while the reader is there (S5.2): on every change of `changes`, and while
 * `streaming`, whenever its content grows (Markdown loading, a subagent's steps). Scrolling up stops it and sets
 * `away`; `jump` goes back down and follows again.
 */
export function useFollow(changes: unknown, streaming: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every change may move the bottom.
  useLayoutEffect(() => {
    if (following.current) toEnd(box.current);
  }, [changes]);
  useEffect(() => {
    const element = content.current;
    if (!streaming || element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd(box.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [streaming]);
  const onScroll = () => {
    const element = box.current;
    if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
    setAway(!following.current);
  };
  const jump = () => {
    following.current = true;
    setAway(false);
    toEnd(box.current);
  };
  return { box, content, away, onScroll, jump };
}
