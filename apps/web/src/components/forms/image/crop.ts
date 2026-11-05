/**
 * The maths of a square crop. A `CropRect` is the square taken from the source image, in its pixels. A `CropView`
 * is how the cropper shows it: the image scaled by `zoom` over the "cover" scale (the square filled exactly) and its
 * centre moved `dx`, `dy` frame pixels from the frame's centre. The two convert both ways.
 */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface CropView {
  /** 1 fills the frame with the image's shorter side; up to `MAX_ZOOM`. */
  readonly zoom: number;
  readonly dx: number;
  readonly dy: number;
}

export interface Source {
  readonly width: number;
  readonly height: number;
}

export const MAX_ZOOM = 4;
export const DEFAULT_VIEW: CropView = { zoom: 1, dx: 0, dy: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The centred square that fills the frame: the whole shorter side, the longer one cut evenly on both ends. */
export function coverCrop({ width, height }: Source): CropRect {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/** Frame pixels per source pixel at `zoom`. */
function scaleOf(view: CropView, frame: number, source: Source): number {
  return (frame / Math.min(source.width, source.height)) * view.zoom;
}

/** The view kept inside its bounds: the zoom in range, the image always covering the frame. */
export function clampView(view: CropView, frame: number, source: Source): CropView {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const scale = scaleOf({ ...view, zoom }, frame, source);
  const maxX = Math.max(0, (source.width * scale - frame) / 2);
  const maxY = Math.max(0, (source.height * scale - frame) / 2);
  return { zoom, dx: clamp(view.dx, -maxX, maxX), dy: clamp(view.dy, -maxY, maxY) };
}

/** Where the image sits in the frame: its drawn size and its top-left corner, in frame pixels. */
export function placement(view: CropView, frame: number, source: Source) {
  const scale = scaleOf(view, frame, source);
  const width = source.width * scale;
  const height = source.height * scale;
  return { width, height, left: (frame - width) / 2 + view.dx, top: (frame - height) / 2 + view.dy };
}

/** The square of the source the frame shows, rounded to whole pixels and kept inside the image. */
export function viewToRect(view: CropView, frame: number, source: Source): CropRect {
  const scale = scaleOf(view, frame, source);
  const size = Math.min(Math.round(frame / scale), source.width, source.height);
  const x = clamp(Math.round((source.width - size) / 2 - view.dx / scale), 0, source.width - size);
  const y = clamp(Math.round((source.height - size) / 2 - view.dy / scale), 0, source.height - size);
  return { x, y, size };
}

/** The view that shows `rect` (to adjust an earlier crop), kept inside its bounds. */
export function rectToView(rect: CropRect, frame: number, source: Source): CropView {
  const scale = frame / rect.size;
  const zoom = scale / (frame / Math.min(source.width, source.height));
  return clampView(
    {
      zoom,
      dx: ((source.width - rect.size) / 2 - rect.x) * scale,
      dy: ((source.height - rect.size) / 2 - rect.y) * scale,
    },
    frame,
    source,
  );
}

export function sameView(a: CropView, b: CropView): boolean {
  return Math.abs(a.zoom - b.zoom) < 0.001 && Math.abs(a.dx - b.dx) < 0.5 && Math.abs(a.dy - b.dy) < 0.5;
}
