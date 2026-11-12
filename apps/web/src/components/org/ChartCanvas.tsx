import { Maximize, Minus, Plus } from 'lucide-react';
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';
import { canvasEvents, usePanZoom, useWheel } from './canvas-input.ts';
import { type CanvasView, firstView, fitView, readView, saveView, ZOOM, zoomAbout } from './canvas-view.ts';

export { DRAGGABLE } from './canvas-input.ts';

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
 * The canvas's view: the first one (remembered for this canvas's width, else `firstView`), fitting the chart or a box
 * of it (`fitTo`), and remembering it a moment after each change, which also tells `onMove`.
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
    // A view set meanwhile (a `fitTo` right after mounting) stays: StrictMode runs this effect again with the old view.
    setRawView((v) => v ?? readView(storageKey, r.width) ?? firstView(width, height, r.width, r.height));
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
