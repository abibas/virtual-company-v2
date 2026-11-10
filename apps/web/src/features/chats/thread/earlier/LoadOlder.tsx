import { ArrowUp } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import { Spinner } from '../../../../components/ui/Button.tsx';

/**
 * "Load older messages" at the top of the current conversation while older turns are left out: a button, which also
 * loads by itself when it scrolls into view (an IntersectionObserver on the thread's scrolling box), again after each
 * page while it stays in view. A failure stops the automatic loading until the button is pressed.
 */
export function LoadOlder({
  root,
  left,
  loading,
  failed,
  onLoad,
}: {
  /** The thread's scrolling box. */
  readonly root: RefObject<HTMLElement | null>;
  /** About how many older turns are left out. */
  readonly left: number;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onLoad: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const load = useRef(onLoad);
  load.current = onLoad;
  // Observed again after each page (`left` changes), so a row still in view loads the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `left` restarts the observer on purpose.
  useEffect(() => {
    const element = row.current;
    if (element === null || loading || failed || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load.current();
      },
      { root: root.current, rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, loading, failed, left]);
  return (
    <div ref={row} className="flex justify-center">
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-2xs font-semibold text-dim ring-1 ring-line ring-inset transition-colors hover:bg-surface-2 hover:text-ink-2 disabled:cursor-default disabled:hover:bg-transparent"
      >
        {loading ? (
          <Spinner size={12} className="text-blue" />
        ) : (
          <ArrowUp size={12} aria-hidden="true" className="text-faint" />
        )}
        {loading
          ? 'Loading older messages…'
          : failed
            ? "Older messages didn't load. Try again"
            : left > 0
              ? `Load older messages · ${left} more`
              : 'Load older messages'}
      </button>
    </div>
  );
}
