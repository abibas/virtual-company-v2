import { AttachError, attachable, CHAT_IMAGE_MAX_BYTES } from './image-files.ts';

/**
 * An attached image made to fit a message (T-18): one of at most 3 MB goes as it is; a larger PNG, JPEG or WebP (a big
 * Retina screenshot) is drawn smaller on a canvas, kept a PNG when the PNG fits, else made a WebP at high quality (a
 * JPEG where the browser cannot write WebP), smaller again until it fits; a larger GIF (its frames would be lost) or one
 * that never fits is refused.
 */

/** Each try draws the image this much smaller than the last. */
const STEP = 0.8;
/** Below this longest side the image is not worth sending smaller: refused. */
const MIN_SIDE = 480;

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The image decoded, upright as its EXIF says. */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new AttachError('unreadable');
  }
}

/** The encodings tried at each size, in order: a PNG stays a PNG while it fits. */
const encodings = (type: string): readonly (readonly [string, number | undefined])[] =>
  type === 'image/png'
    ? [
        ['image/png', undefined],
        ['image/webp', 0.92],
      ]
    : [
        ['image/webp', 0.92],
        ['image/jpeg', 0.9],
      ];

/** The first encoding of the canvas that fits, of a type a message takes (a browser may write PNG for WebP). */
async function fitting(canvas: HTMLCanvasElement, type: string): Promise<Blob | undefined> {
  for (const [as, quality] of encodings(type)) {
    const blob = await encode(canvas, as, quality);
    if (blob && attachable(blob) && blob.size <= CHAT_IMAGE_MAX_BYTES) return blob;
  }
  return undefined;
}

/** `bitmap` drawn smaller and smaller until an encoding fits; undefined when it no longer would be worth it. */
async function shrink(bitmap: ImageBitmap, type: string, start: number): Promise<Blob | undefined> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new AttachError('unreadable');
  for (let scale = start; Math.max(bitmap.width, bitmap.height) * scale >= MIN_SIDE; scale *= STEP) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await fitting(canvas, type);
    if (blob) return blob;
  }
  return undefined;
}

/** The file as it goes with the message: as it is when it fits, else scaled down to fit; refused otherwise. */
export async function fitImage(file: File): Promise<Blob> {
  if (!attachable(file)) throw new AttachError('type');
  if (file.size <= CHAT_IMAGE_MAX_BYTES) return file;
  if (file.type === 'image/gif') throw new AttachError('gif_too_large');
  const bitmap = await decode(file);
  try {
    // The bytes go roughly with the pixels: the first try is about the size that fits.
    const blob = await shrink(bitmap, file.type, Math.min(STEP, Math.sqrt(CHAT_IMAGE_MAX_BYTES / file.size)));
    if (!blob) throw new AttachError('too_large');
    return blob;
  } finally {
    bitmap.close();
  }
}
