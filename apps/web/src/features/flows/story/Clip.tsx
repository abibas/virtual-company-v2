import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../../components/cx.ts';

/**
 * A text clipped to one line (or `lines`), with "more" when it does not fit and "less" once opened: a long reason or an
 * error never takes ten lines until asked.
 */
export function Clip({
  text,
  lines = 1,
  className,
}: {
  readonly text: string;
  readonly lines?: 1 | 2;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text or closing it again is what needs measuring again.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    const check = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(element);
    return () => watch.disconnect();
  }, [open, text]);
  return (
    <span className={cx('flex min-w-0 items-baseline gap-1.5', className)}>
      <span
        ref={ref}
        className={cx(
          'min-w-0 flex-1 break-words',
          open ? 'whitespace-pre-wrap' : lines === 1 ? 'line-clamp-1' : 'line-clamp-2',
        )}
      >
        {text}
      </span>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 cursor-pointer rounded-xs text-2xs font-semibold text-blue hover:underline"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </span>
  );
}
