import { type RefObject, useEffect, useRef } from 'react';

/**
 * A link to a turn (`#turn-<id>`, a decision's "in its chat"): once that turn is in the thread, the box scrolls to it,
 * once, after the thread's own scroll to the latest; `onScrolled` lets the following know the reader is elsewhere.
 */
export function useTurnAnchor(
  box: RefObject<HTMLDivElement | null>,
  changes: unknown,
  onScrolled: () => void,
): void {
  const done = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each change may bring the linked turn in.
  useEffect(() => {
    if (done.current || typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#turn-')) return;
    const element = box.current?.querySelector(`[id="${CSS.escape(hash.slice(1))}"]`);
    if (!element) return;
    done.current = true;
    element.scrollIntoView({ block: 'start' });
    onScrolled();
  }, [changes]);
}
