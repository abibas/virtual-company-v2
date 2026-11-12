import { useCallback, useState } from 'react';

/** The open right rail's width in px: its default (`--spacing-aside`), the narrowest, and the widest share of the window. */
export const RAIL_WIDTH = { default: 356, min: 320, max: 960, maxShare: 0.6 } as const;

/** Where the person's width is kept, in this browser only. */
const KEY = 'mwc.rightRail.width';

/** The widest the rail may be in this window: 960 px, or 60% of the window when that is less. */
export const railMax = (): number =>
  Math.max(RAIL_WIDTH.min, Math.min(RAIL_WIDTH.max, window.innerWidth * RAIL_WIDTH.maxShare));

/** A width within the bounds, whole pixels. */
export const clampRail = (width: number): number =>
  Math.round(Math.min(railMax(), Math.max(RAIL_WIDTH.min, width)));

function readWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : RAIL_WIDTH.default;
  } catch {
    return RAIL_WIDTH.default;
  }
}

function writeWidth(width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(width));
  } catch {
    // Storage blocked (a private window): the width holds for this page only.
  }
}

export interface RailWidth {
  /** The width now, within this window's bounds. */
  readonly width: number;
  /** Follows a drag, not kept yet. */
  preview(width: number): void;
  /** Sets and keeps the width. */
  keep(width: number): void;
  /** Back to the default, forgetting the kept width. */
  reset(): void;
}

/** The open right rail's width: the person's own (`mwc.rightRail.width`), or the default. */
export function useRailWidth(): RailWidth {
  const [width, setWidth] = useState(readWidth);
  const preview = useCallback((next: number) => setWidth(clampRail(next)), []);
  const keep = useCallback((next: number) => {
    const clamped = clampRail(next);
    writeWidth(clamped);
    setWidth(clamped);
  }, []);
  const reset = useCallback(() => {
    writeWidth(null);
    setWidth(RAIL_WIDTH.default);
  }, []);
  return { width: clampRail(width), preview, keep, reset };
}
