import { type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasHandle } from '../../components/org/ChartCanvas.tsx';
import { DROP_ID } from '../../components/org/ChartCard.tsx';

/** A card being dragged: whose, where the pointer is (screen), and the drop target under it, if any. */
export interface Dragging {
  readonly principalId: string;
  readonly x: number;
  readonly y: number;
  readonly over: string | undefined;
}

/** How far a mouse moves before a press becomes a drag; how far a finger may move before its long press is a pan. */
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 10;
/** How long a finger rests on a card before it lifts it (a shorter touch pans the canvas). */
const LONG_PRESS_MS = 380;
/** Near the canvas's edge, a dragged card pans it, faster the closer it gets. */
const EDGE = 56;
const EDGE_SPEED = 14;

/** One press on a card, followed until it ends. */
interface Session {
  readonly principalId: string;
  readonly pointerId: number;
  readonly touch: boolean;
  readonly x0: number;
  readonly y0: number;
  x: number;
  y: number;
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
  frame?: number;
}

/** The drop target under a screen point: the nearest element with a drop id (the dragged ghost lets pointers through). */
function targetAt(x: number, y: number): string | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    const id = element.closest(`[${DROP_ID}]`)?.getAttribute(DROP_ID);
    if (id) return id;
  }
  return undefined;
}

/** How fast to pan when the pointer is within `EDGE` of a side of the canvas, as `[dx, dy]` per frame. */
function edgePan(box: DOMRect | undefined, x: number, y: number): readonly [number, number] {
  if (!box) return [0, 0];
  const speed = (gap: number) => (gap < EDGE ? Math.ceil(((EDGE - gap) / EDGE) * EDGE_SPEED) : 0);
  return [speed(x - box.left) - speed(box.right - x), speed(y - box.top) - speed(box.bottom - y)];
}

/** What following one press does: start the drag, show where it is, drop it, and end. */
interface Follow {
  begin(s: Session): void;
  show(s: Session): void;
  drop(target: string): void;
  ended(): void;
}

/**
 * Follows one press until it ends: a mouse becomes a drag after `MOUSE_SLOP` pixels, a finger after resting
 * `LONG_PRESS_MS` (moving first makes it a pan, and this lets go); a drag ends in a drop on the target under the
 * pointer, or with Escape. Returns the way to stop following.
 */
function follow(s: Session, f: Follow): () => void {
  if (s.touch) s.timer = setTimeout(() => f.begin(s), LONG_PRESS_MS);
  const onMove = (e: globalThis.PointerEvent) => {
    if (e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (s.started) {
      e.preventDefault();
      f.show(s);
      return;
    }
    const moved = Math.hypot(s.x - s.x0, s.y - s.y0);
    if (s.touch && moved > TOUCH_SLOP) stop();
    else if (!s.touch && moved > MOUSE_SLOP) f.begin(s);
  };
  const onUp = (e: globalThis.PointerEvent) => {
    if (e.pointerId !== s.pointerId) return;
    const target = s.started ? targetAt(e.clientX, e.clientY) : undefined;
    stop();
    if (target !== undefined) f.drop(target);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') stop();
  };
  const onMenu = (e: Event) => {
    if (s.started || s.touch) e.preventDefault();
  };
  function stop() {
    clearTimeout(s.timer);
    if (s.frame !== undefined) cancelAnimationFrame(s.frame);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('contextmenu', onMenu);
    f.ended();
  }
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('keydown', onKey);
  window.addEventListener('contextmenu', onMenu);
  return stop;
}

export interface ChartDragOptions {
  /** Admins and owners drag; for anyone else a press does nothing. */
  readonly enabled: boolean;
  readonly canvas: RefObject<CanvasHandle | null>;
  /** The canvas's box on screen, for panning at its edges. */
  readonly viewport: () => DOMRect | undefined;
  /** A card was dropped on a target (a principal's id, or the company). */
  readonly onDrop: (principalId: string, target: string) => void;
}

/**
 * How a press becomes a drag: the canvas stops panning, the card shows under the pointer, and every frame the canvas
 * pans while the pointer is near its edges.
 */
function starter(opts: RefObject<ChartDragOptions>, show: (s: Session) => void) {
  const autoPan = (s: Session) => {
    const [dx, dy] = edgePan(opts.current.viewport(), s.x, s.y);
    if (dx !== 0 || dy !== 0) {
      opts.current.canvas.current?.panBy(dx, dy);
      show(s);
    }
    s.frame = requestAnimationFrame(() => autoPan(s));
  };
  return (s: Session) => {
    s.started = true;
    opts.current.canvas.current?.cancelPan();
    show(s);
    s.frame = requestAnimationFrame(() => autoPan(s));
  };
}

/**
 * Dragging cards with pointer events (a mouse, a pen, a finger after a long press), so it works the same on phones and
 * stays clear of the canvas's own panning; Escape cancels. The drop target is the card (or the company) under the
 * pointer; near the canvas's edges the canvas pans. `grab(principalId)` is a card's `onPointerDown`.
 */
export function useChartDrag(options: ChartDragOptions) {
  const [dragging, setDragging] = useState<Dragging>();
  const stopping = useRef<() => void>(null);
  const opts = useRef(options);
  opts.current = options;

  const show = useCallback((s: Session) => {
    setDragging({ principalId: s.principalId, x: s.x, y: s.y, over: targetAt(s.x, s.y) });
  }, []);

  const begin = useMemo(() => starter(opts, show), [show]);

  const grab = useCallback(
    (principalId: string) => (event: PointerEvent<HTMLElement>) => {
      if (!opts.current.enabled || stopping.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if ((event.target as Element).closest('button, a, [role="menu"]')) return;
      const { pointerId, clientX: x, clientY: y } = event;
      const s: Session = {
        principalId,
        pointerId,
        touch: event.pointerType === 'touch',
        x0: x,
        y0: y,
        x,
        y,
        started: false,
      };
      stopping.current = follow(s, {
        begin,
        show,
        drop: (target) => opts.current.onDrop(principalId, target),
        ended: () => {
          stopping.current = null;
          setDragging(undefined);
        },
      });
    },
    [begin, show],
  );

  const cancel = useCallback(() => stopping.current?.(), []);
  useEffect(() => cancel, [cancel]);
  return { dragging, grab, cancel };
}
