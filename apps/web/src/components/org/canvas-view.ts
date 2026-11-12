/**
 * The chart canvas's view: how far it is panned (`x`, `y`, screen pixels) and zoomed (`k`), the math of zooming about
 * a point and of fitting the chart, and the view remembered per browser. Pure but for the storage, which may be
 * missing or refuse (a private window): the canvas then starts fitted.
 */

export interface CanvasView {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/** A view as remembered: with the canvas's width then, so a view left on a phone does not open a desktop. */
interface Remembered extends CanvasView {
  readonly w: number;
}

export const ZOOM = { min: 0.3, max: 1.75, step: 1.2 } as const;

/** The room kept around a fitted chart, in screen pixels. */
const PAD = 32;
/** The column at the canvas's right edge that the zoom buttons take, kept clear by a fit. */
const CONTROLS = 56;

export const clampZoom = (k: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, k));

/** The view zoomed to `k` (clamped) so the chart point under the screen point `(px, py)` stays under it. */
export function zoomAbout(view: CanvasView, k: number, px: number, py: number): CanvasView {
  const next = clampZoom(k);
  const ratio = next / view.k;
  return { k: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/**
 * The view that shows the whole chart (`width` × `height`) in the viewport (`vw` × `vh`): never zoomed in past 1,
 * centred across the room left of the zoom buttons, and from the top down (a short chart does not float in the middle
 * of a tall canvas).
 */
export function fitView(width: number, height: number, vw: number, vh: number): CanvasView {
  const room = vw - CONTROLS;
  const k = clampZoom(Math.min((room - 2 * PAD) / width, (vh - 2 * PAD) / height, 1));
  return { k, x: (room - width * k) / 2, y: Math.min(Math.max(PAD, (vh - height * k) / 2), 2 * PAD + 24) };
}

/** Below this zoom the cards cannot be read; a first view is never smaller, and starts at the company on top. */
const READABLE = 0.55;

/**
 * The first view of a chart: fitted (`fitView`) when it can be read that way; else (a big chart, a phone) at a zoom
 * that can be read, centred across on the company at the top, to pan from there.
 */
export function firstView(width: number, height: number, vw: number, vh: number): CanvasView {
  const fitted = fitView(width, height, vw, vh);
  if (fitted.k >= READABLE) return fitted;
  return { k: READABLE, x: (vw - width * READABLE) / 2, y: PAD };
}

const KEY = 'mwc:org-chart:view:';

const isRemembered = (value: unknown): value is Remembered => {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, k, w } = value as Record<string, unknown>;
  return [x, y, k, w].every((n) => typeof n === 'number' && Number.isFinite(n));
};

/**
 * The view remembered in this browser for `key` (a company), or undefined: none was, or it was left on a canvas of
 * another width (more than a fifth apart: a phone and a desktop), where it would not show the same.
 */
export function readView(key: string, width: number): CanvasView | undefined {
  try {
    const raw = window.localStorage.getItem(KEY + key);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    if (!isRemembered(value) || Math.abs(value.w - width) > width / 5) return undefined;
    return { x: value.x, y: value.y, k: clampZoom(value.k) };
  } catch {
    return undefined;
  }
}

/** Remembers the view on a canvas `width` wide in this browser for `key`; a storage that refuses is ignored. */
export function saveView(key: string, view: CanvasView, width: number): void {
  try {
    window.localStorage.setItem(KEY + key, JSON.stringify({ ...view, w: width }));
  } catch {
    // Remembering the view is a convenience; the canvas works without it.
  }
}
