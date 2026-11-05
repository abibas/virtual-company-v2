import { Check, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { type Ref, useId, useImperativeHandle, useRef, useState } from 'react';
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
import { onKeys, type Update, usePointers, useWheelZoom } from './crop-gestures.ts';

/** The square frame, in CSS pixels (`size-56`), inside a `size-72` stage with `inset-8` around the frame. */
const FRAME = 224;
const INSET = 32;

/** The crop as it stands, for a save that applies it without Done (Create pressed with the crop step open). */
export interface ImageCropperHandle {
  crop(): CropRect;
}

/** The frame's mask: a company logo's rounded tile, or a person's round photo. */
export type CropShape = 'square' | 'round';

const MASKS: Readonly<Record<CropShape, { readonly className: string; readonly says: string }>> = {
  square: { className: 'rounded-[25%]', says: 'the square is what the tile will show' },
  round: { className: 'rounded-full', says: 'the circle is what the photo will show' },
};

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
  /** The frame's mask (`square` by default); the result is a square either way. */
  readonly shape?: CropShape;
  readonly className?: string;
  readonly ref?: Ref<ImageCropperHandle>;
}

/** The stage: the image under the pointers and keys, and the frame masked as a tile or a photo over it. */
function CropStage({
  src,
  view,
  source,
  update,
  label,
  hintId,
  shape,
}: {
  readonly src: string;
  readonly view: CropView;
  readonly source: Source;
  readonly update: Update;
  readonly label: string;
  readonly hintId: string;
  readonly shape: CropShape;
}) {
  const stage = useRef<HTMLButtonElement>(null);
  const pointers = usePointers(update);
  useWheelZoom(stage, update);
  const image = placement(view, FRAME, source);
  return (
    <button
      ref={stage}
      type="button"
      aria-label={`${label}: ${MASKS[shape].says}`}
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
        className={cx(
          'pointer-events-none absolute inset-8 shadow-[0_0_0_160px_rgba(10,12,30,0.55)] ring-2 ring-white/90',
          MASKS[shape].className,
        )}
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

/** Reset on the left; Cancel and Done on the right. */
function CropActions({
  atDefault,
  busy,
  onReset,
  onCancel,
  onDone,
}: {
  readonly atDefault: boolean;
  readonly busy: boolean;
  readonly onReset: () => void;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" tone="quiet" icon={RotateCcw} disabled={atDefault || busy} onClick={onReset}>
        Reset
      </Button>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" icon={Check} busy={busy} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * A square crop of an image, by hand: drag (or touch) to move it, the slider, the wheel, a pinch or plus and
 * minus to zoom, the arrow keys to move. The frame is masked like a `CompanyLogo` tile, or round like a person's
 * `Avatar` with `shape="round"`, so what it shows is what the tile or the photo will show; what falls outside is
 * dimmed. Done gives the square in the source's pixels.
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
  shape = 'square',
  className,
  ref,
}: ImageCropperProps) {
  const source: Source = { width, height };
  const hintId = useId();
  const [view, setView] = useState<CropView>(() =>
    initial ? rectToView(initial, FRAME, source) : clampView(DEFAULT_VIEW, FRAME, source),
  );
  useImperativeHandle(ref, () => ({ crop: () => viewToRect(view, FRAME, { width, height }) }), [
    view,
    width,
    height,
  ]);
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
      <CropStage
        src={src}
        view={view}
        source={source}
        update={update}
        label={label}
        hintId={hintId}
        shape={shape}
      />
      <ZoomSlider zoom={view.zoom} update={update} />
      <CropActions
        atDefault={atDefault}
        busy={busy}
        onReset={() => update(() => DEFAULT_VIEW)}
        onCancel={onCancel}
        onDone={() => onDone(viewToRect(view, FRAME, source))}
      />
    </div>
  );
}
