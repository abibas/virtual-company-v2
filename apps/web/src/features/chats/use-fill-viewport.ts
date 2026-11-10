import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The height that makes an element end exactly `bottomGap` pixels above the window's bottom, from where it starts, on
 * wide screens (the chat page's columns: only the thread and the list scroll, never the page). Undefined on narrow
 * screens, where the columns stack and the page scrolls. Measured again on resize and when the content above moves.
 */
export function useFillViewport(
  ref: RefObject<HTMLElement | null>,
  bottomGap: number,
  minWidth = 1024,
): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (window.innerWidth < minWidth) return setHeight(undefined);
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(window.innerHeight - top - bottomGap, 320));
    };
    measure();
    window.addEventListener('resize', measure);
    const above = new ResizeObserver(measure);
    if (element.parentElement) above.observe(element.parentElement);
    return () => {
      window.removeEventListener('resize', measure);
      above.disconnect();
    };
  }, [ref, bottomGap, minWidth]);
  return height;
}
