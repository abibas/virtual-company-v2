import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How close to the bottom counts as reading the latest: the thread follows new output only then. */
const FOLLOW_PX = 96;

function toEnd(element: HTMLElement | null) {
  if (element) element.scrollTop = element.scrollHeight;
}

/** The reader is selecting text in the box (a selection in it, or the pointer held down in it): following waits. */
function selecting(element: HTMLElement | null, held: boolean): boolean {
  if (element === null) return false;
  if (held) return true;
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false;
  return element.contains(selection.getRangeAt(0).commonAncestorContainer);
}

/**
 * Keeps a scrolling box at its bottom while the reader is there (S5.2): on every change of `changes`, and while
 * `streaming`, whenever its content grows (Markdown loading, a subagent's steps). Scrolling up stops it and sets
 * `away`; `jump` goes back down and follows again. While the reader selects text in the box (the pointer held down,
 * or a selection in it), the box stays where it is: jumping to the end under a selection used to tear it away.
 */
export function useFollow(changes: unknown, streaming: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const held = useRef(false);
  const [away, setAway] = useState(false);
  const follow = () => {
    if (following.current && !selecting(box.current, held.current)) toEnd(box.current);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: every change may move the bottom.
  useLayoutEffect(follow, [changes]);
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const down = () => {
      held.current = true;
    };
    const up = () => {
      held.current = false;
    };
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  useEffect(() => {
    const element = content.current;
    if (!streaming || element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.current && !selecting(box.current, held.current)) toEnd(box.current);
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
