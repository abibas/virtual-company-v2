import { Maximize, Minus, Plus } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';
import { type CanvasView, firstView, fitView, readView, saveView, ZOOM, zoomAbout } from './canvas-view.ts';

/** What a canvas's owner may ask of it while it drags a card over it. */
export interface CanvasHandle {
  /** Pans by screen pixels (a card dragged near the edge). */
  panBy(dx: number, dy: number): void;
  /** Ends a pan in progress (a long press that turned into dragging a card). */
  cancelPan(): void;
  /** Shows a box of the chart (chart pixels) as `fitView` shows the whole chart (a highlighted group). */
  fitTo(box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }): void;
}

/** What starts no pan: the controls, and (for a mouse or a pen) a card that may be dragged. */
const NO_PAN = 'button, a, input, select, textarea, [role="menu"]';
export const DRAGGABLE = 'data-chart-draggable';

type Point = { readonly x: number; readonly y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Panning by a pointer, and pinching with two (phones): the pointers down on the canvas and what they do. */
function usePanZoom(
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
function useWheel(
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

export interface ChartCanvasProps {
  /** The chart's size, in chart pixels. */
  readonly width: number;
  readonly height: number;
  /** Where this browser remembers the view (a company's id). */
  readonly storageKey: string;
  readonly label: string;
  readonly handle?: Ref<CanvasHandle>;
  /** The view changed (panned, zoomed): menus anchored to a card close. */
  readonly onMove?: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The canvas's view: the first one (remembered for this canvas's width, else `firstView`), fitting, and remembering it
 * a moment after each change, which also tells `onMove`.
 */
function useCanvasView(box: RefObject<HTMLDivElement | null>, props: ChartCanvasProps) {
  const { width, height, storageKey } = props;
  const [view, setRawView] = useState<CanvasView>();
  const setView = useCallback((f: (v: CanvasView) => CanvasView) => setRawView((v) => (v ? f(v) : v)), []);
  const fit = useCallback(() => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.width > 0) setRawView(fitView(width, height, r.width, r.height));
  }, [box, width, height]);
  const fitTo = useCallback<CanvasHandle['fitTo']>(
    (b) => {
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      const { k, x, y } = fitView(b.width, b.height, r.width, r.height);
      setRawView({ k, x: x - b.x * k, y: y - b.y * k });
    },
    [box],
  );
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (view !== undefined || !r || r.width === 0) return;
    setRawView(readView(storageKey, r.width) ?? firstView(width, height, r.width, r.height));
  }, [box, view, storageKey, width, height]);
  const moved = useRef(props.onMove);
  moved.current = props.onMove;
  useEffect(() => {
    if (!view) return;
    moved.current?.();
    const timer = setTimeout(() => saveView(storageKey, view, box.current?.clientWidth ?? 0), 300);
    return () => clearTimeout(timer);
  }, [box, view, storageKey]);
  return { view, setView, fit, fitTo };
}

/** Zoom in, zoom out and fit, with the zoom in per cent, in the canvas's top right corner. */
function ZoomControls({
  k,
  zoomBy,
  fit,
}: {
  readonly k: number;
  readonly zoomBy: (f: number) => void;
  readonly fit: () => void;
}) {
  return (
    <div className="absolute top-3 right-3 flex flex-col items-center gap-1.5 rounded-xl bg-surface/90 p-1 shadow-card ring-1 ring-line backdrop-blur">
      <IconButton label="Zoom in" icon={Plus} size="sm" onClick={() => zoomBy(ZOOM.step)} />
      <IconButton label="Zoom out" icon={Minus} size="sm" onClick={() => zoomBy(1 / ZOOM.step)} />
      <IconButton label="Fit to screen" icon={Maximize} size="sm" onClick={fit} />
      <span className="pb-0.5 font-mono text-2xs text-dim tabular-nums">{Math.round(k * 100)}%</span>
    </div>
  );
}

/**
 * The canvas's own events: the keys that pan, zoom and fit while it has the focus, and a scroll the browser makes to
 * show a card focused off screen, which becomes a pan (the canvas moves by its view, never by scrolling).
 */
function canvasEvents(setView: (f: (v: CanvasView) => CanvasView) => void, fit: () => void) {
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

/**
 * A chart on a dotted canvas that pans (drag the background, the wheel, the arrow keys, one finger) and zooms (+ and −,
 * Ctrl or ⌘ and the wheel, a trackpad's or two fingers' pinch), with zoom and fit buttons in its top right corner. It
 * starts fitted (at a zoom that can be read, on a big chart or a phone), and this browser remembers where it was left.
 */
export function ChartCanvas(props: ChartCanvasProps) {
  const { width, height, label, handle, className, children } = props;
  const box = useRef<HTMLDivElement>(null);
  const { view, setView, fit, fitTo } = useCanvasView(box, props);
  const { panning, stop, handlers } = usePanZoom(box, setView);
  useWheel(box, setView);
  useImperativeHandle(
    handle,
    () => ({
      panBy: (dx, dy) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })),
      cancelPan: stop,
      fitTo,
    }),
    [setView, stop, fitTo],
  );
  const zoomBy = (factor: number) => {
    const r = box.current?.getBoundingClientRect();
    setView((v) => zoomAbout(v, v.k * factor, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2));
  };
  const { onScroll, onKeyDown } = canvasEvents(setView, fit);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of cards that pans and zooms, not a form's fieldset.
    <div
      ref={box}
      role="group"
      aria-label={label}
      aria-roledescription="canvas"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes the keys that pan and zoom it.
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      {...handlers}
      className={cx(
        'canvas-dots relative touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-blue/40',
        panning ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width,
          height,
          transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined,
          visibility: view ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
      <ZoomControls k={view?.k ?? 1} zoomBy={zoomBy} fit={fit} />
    </div>
  );
}
