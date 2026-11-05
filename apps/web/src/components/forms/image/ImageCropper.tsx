import { Check, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cx } from '../../cx.ts';
import { Button } from '../../ui/Button.tsx';
import {
  type CropRect,
  type CropView,
  clampView,
  DEFAULT_VIEW,
  MAX_ZOOM,
  placement,
  rectToView,
  type Source,
  sameView,
  viewToRect,
} from './crop.ts';

/** The square frame, in CSS pixels (`size-56`), inside a `size-72` stage with `inset-8` around the frame. */
const FRAME = 224;
const INSET = 32;
const STEP = 8;

type Update = (change: (view: CropView) => CropView) => void;

export interface ImageCropperProps extends Source {
  /** The image (an object or data URL). */
  readonly src: string;
  /** The crop to start from (adjusting an earlier one); else the centred square that fills the frame. */
  readonly initial?: CropRect | undefined;
  readonly onDone: (crop: CropRect) => void;
  readonly onCancel: () => void;
  readonly label?: string;
  /** Done is working (the result is being encoded). */
  readonly busy?: boolean;
  readonly className?: string;
}

/** The pointers on the stage: one drags, two pinch (and drag by their midpoint). */
function usePointers(update: Update) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const span = distance();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = (event.clientX - before.x) / pointers.current.size;
    const dy = (event.clientY - before.y) / pointers.current.size;
    const ratio = span > 0 ? distance() / span : 1;
    update((view) => ({ zoom: view.zoom * ratio, dx: view.dx + dx, dy: view.dy + dy }));
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** Arrow keys move the image (Shift: further), plus and minus zoom it. */
function onKeys(event: KeyboardEvent<HTMLElement>, update: Update) {
  const step = event.shiftKey ? STEP * 4 : STEP;
  const moves: Record<string, readonly [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const move = moves[event.key];
  const zoom = ['+', '='].includes(event.key) ? 1.1 : ['-', '_'].includes(event.key) ? 1 / 1.1 : undefined;
  if (!move && zoom === undefined) return;
  event.preventDefault();
  update((view) =>
    move
      ? { ...view, dx: view.dx + move[0], dy: view.dy + move[1] }
      : { ...view, zoom: view.zoom * (zoom ?? 1) },
  );
}

/** The wheel zooms without scrolling the page; a listener React would register as passive cannot say so. */
function useWheelZoom(stage: RefObject<HTMLButtonElement | null>, update: Update) {
  const latest = useRef(update);
  latest.current = update;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      latest.current((view) => ({ ...view, zoom: view.zoom * Math.exp(-event.deltaY * 0.0015) }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [stage]);
}

/** The stage: the image under the pointers and the keys, and the frame masked like a logo tile over it. */
function CropStage({
  src,
  view,
  source,
  update,
  label,
  hintId,
}: {
  readonly src: string;
  readonly view: CropView;
  readonly source: Source;
  readonly update: Update;
  readonly label: string;
  readonly hintId: string;
}) {
  const stage = useRef<HTMLButtonElement>(null);
  const pointers = usePointers(update);
  useWheelZoom(stage, update);
  const image = placement(view, FRAME, source);
  return (
    <button
      ref={stage}
      type="button"
      aria-label={`${label}: the square is what the tile will show`}
      aria-describedby={hintId}
      onKeyDown={(event) => onKeys(event, update)}
      {...pointers}
      className="relative mx-auto block size-72 cursor-grab touch-none overflow-hidden rounded-2xl bg-surface-3 select-none active:cursor-grabbing"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute top-0 left-0 max-w-none"
        style={{
          width: image.width,
          height: image.height,
          transform: `translate(${image.left + INSET}px, ${image.top + INSET}px)`,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-8 rounded-[25%] shadow-[0_0_0_160px_rgba(10,12,30,0.55)] ring-2 ring-white/90"
      />
    </button>
  );
}

/** The zoom, between the two glasses. */
function ZoomSlider({ zoom, update }: { readonly zoom: number; readonly update: Update }) {
  return (
    <div className="flex items-center gap-2">
      <ZoomOut size={16} aria-hidden="true" className="shrink-0 text-dim" />
      <input
        type="range"
        aria-label="Zoom"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(event) => update((current) => ({ ...current, zoom: Number(event.target.value) }))}
        className="h-1.5 w-full cursor-pointer accent-blue"
      />
      <ZoomIn size={16} aria-hidden="true" className="shrink-0 text-dim" />
    </div>
  );
}

/**
 * A square crop of an image, by hand: drag (or touch) to move it, the slider, the wheel, a pinch or plus and
 * minus to zoom, the arrow keys to move. The frame is masked like a `CompanyLogo` tile, so what it shows is what the
 * tile will show; what falls outside is dimmed. Done gives the square in the source's pixels.
 */
export function ImageCropper({
  src,
  width,
  height,
  initial,
  onDone,
  onCancel,
  label = 'Crop the image',
  busy = false,
  className,
}: ImageCropperProps) {
  const source: Source = { width, height };
  const hintId = useId();
  const [view, setView] = useState<CropView>(() =>
    initial ? rectToView(initial, FRAME, source) : clampView(DEFAULT_VIEW, FRAME, source),
  );
  const update: Update = (change) => setView((current) => clampView(change(current), FRAME, source));
  const atDefault = sameView(view, clampView(DEFAULT_VIEW, FRAME, source));
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div>
        <p className="text-sm font-semibold text-ink-2">{label}</p>
        <p id={hintId} className="text-xs text-dim">
          Drag to move. Scroll, pinch or use the slider to zoom; arrow keys and plus and minus work too.
        </p>
      </div>
      <CropStage src={src} view={view} source={source} update={update} label={label} hintId={hintId} />
      <ZoomSlider zoom={view.zoom} update={update} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          tone="quiet"
          icon={RotateCcw}
          disabled={atDefault || busy}
          onClick={() => update(() => DEFAULT_VIEW)}
        >
          Reset
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            tone="primary"
            icon={Check}
            busy={busy}
            onClick={() => onDone(viewToRect(view, FRAME, source))}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
