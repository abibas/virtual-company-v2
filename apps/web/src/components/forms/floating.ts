import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react';

/** The space between the trigger and the panel, and kept to the window's edge. */
const GAP = 8;

/**
 * Before the first measure: fixed in a corner and transparent, so the panel is measured without a flash (and its
 * first item can take focus: opacity, unlike visibility, leaves it focusable).
 */
const UNPLACED: CSSProperties = { position: 'fixed', top: 0, left: 0, opacity: 0 };

/**
 * Where an open dropdown floats: fixed to the window below its trigger (above it when the window has no room
 * below), or above it first for a trigger at the bottom of its area (`prefer`: the composer's menus), aligned to the
 * trigger's start or end. A fixed panel is never cut off by a scrolling container (a wide
 * chart, a table); since it would drift from its trigger, any scroll outside it or a resize closes it.
 */
export function useFloatingPanel(
  open: boolean,
  align: 'start' | 'end',
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  close: () => void,
  prefer: 'below' | 'above' = 'below',
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  useLayoutEffect(() => {
    if (!open) {
      setStyle(UNPLACED);
      return;
    }
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      const height = panel.current?.offsetHeight ?? 0;
      const below = window.innerHeight - box.bottom;
      const fitsAbove = box.top >= height + 2 * GAP;
      const up =
        prefer === 'above' ? fitsAbove || box.top > below : below < height + 2 * GAP && box.top > below;
      setStyle({
        position: 'fixed',
        top: up ? Math.max(GAP, box.top - GAP - height) : box.bottom + GAP,
        ...(align === 'end' ? { right: window.innerWidth - box.right } : { left: box.left }),
      });
    }
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, align, trigger, panel, close, prefer]);
  return style;
}
