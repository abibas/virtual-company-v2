/**
 * How the chart canvas takes its input: a pointer's pan and two pointers' pinch, the wheel, the keys while it has the
 * focus, and a scroll the browser makes to show a focused card. Each changes the view through `setView`.
 */

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type CanvasView, ZOOM, zoomAbout } from './canvas-view.ts';

/** What starts no pan: the controls, and (for a mouse or a pen) a card that may be dragged. */
const NO_PAN = 'button, a, input, select, textarea, [role="menu"]';
export const DRAGGABLE = 'data-chart-draggable';

type Point = { readonly x: number; readonly y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Panning by a pointer, and pinching with two (phones): the pointers down on the canvas and what they do. */
export function usePanZoom(
  box: RefObject<HTMLDivElement | null>,
  setView: (f: (v: CanvasView) => CanvasView) => void,
) {
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<{ id: number } & Point>(null);
  const pinch = useRef<number>(null);
  const [panning, setPanning] = useState(false);
  const local = (x: number, y: number): Point => {
    const r = box.current?.getBoundingClientRect();
    return { x: x - (r?.left ?? 0), y: y - (r?.top ?? 0) };
  };
  const stop = useCallback(() => {
    pan.current = null;
    pinch.current = null;
    pointers.current.clear();
    setPanning(false);
  }, []);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (target.closest(NO_PAN)) return;
    if (event.pointerType !== 'touch' && target.closest(`[${DRAGGABLE}]`)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const [a, b] = [...pointers.current.values()];
    if (a && b) {
      pinch.current = distance(a, b);
      pan.current = null;
    } else pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setPanning(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    if (pinch.current !== null && a && b) {
      const now = distance(a, b);
      const centre = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const ratio = now / (pinch.current || now);
      pinch.current = now;
      setView((v) => zoomAbout(v, v.k * ratio, centre.x, centre.y));
    } else if (pan.current?.id === event.pointerId) {
      const { x, y } = pan.current;
      pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      setView((v) => ({ ...v, x: v.x + event.clientX - x, y: v.y + event.clientY - y }));
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pan.current?.id === event.pointerId || pointers.current.size === 0) stop();
  };
  return {
    panning,
    stop,
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
  };
}

/** Ctrl or ⌘ and the wheel (a trackpad's pinch) zoom about the pointer; the wheel alone pans. */
export function useWheel(
  box: RefObject<HTMLDivElement | null>,
  setView: (f: (v: CanvasView) => CanvasView) => void,
) {
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : 1;
      const r = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * unit * 0.0025);
        setView((v) => zoomAbout(v, v.k * factor, event.clientX - r.left, event.clientY - r.top));
      } else setView((v) => ({ ...v, x: v.x - event.deltaX * unit, y: v.y - event.deltaY * unit }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [box, setView]);
}

/** The arrow keys pan, + and − zoom, 0 fits, while the canvas has the focus. */
function keyChange(key: string): ((v: CanvasView, w: number, h: number) => CanvasView) | 'fit' | undefined {
  const pans: Record<string, Point> = {
    ArrowLeft: { x: 64, y: 0 },
    ArrowRight: { x: -64, y: 0 },
    ArrowUp: { x: 0, y: 64 },
    ArrowDown: { x: 0, y: -64 },
  };
  const by = pans[key];
  if (by) return (v) => ({ ...v, x: v.x + by.x, y: v.y + by.y });
  if (key === '+' || key === '=') return (v, w, h) => zoomAbout(v, v.k * ZOOM.step, w / 2, h / 2);
  if (key === '-') return (v, w, h) => zoomAbout(v, v.k / ZOOM.step, w / 2, h / 2);
  return key === '0' ? 'fit' : undefined;
}

/**
 * The canvas's own events: the keys that pan, zoom and fit while it has the focus, and a scroll the browser makes to
 * show a card focused off screen, which becomes a pan (the canvas moves by its view, never by scrolling).
 */
export function canvasEvents(setView: (f: (v: CanvasView) => CanvasView) => void, fit: () => void) {
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollLeft: dx, scrollTop: dy } = event.currentTarget;
    if (dx === 0 && dy === 0) return;
    event.currentTarget.scrollTo(0, 0);
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const change = event.target === event.currentTarget ? keyChange(event.key) : undefined;
    if (!change) return;
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    if (change === 'fit') fit();
    else setView((v) => change(v, r.width, r.height));
  };
  return { onScroll, onKeyDown };
}
