import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { type CropRect, coverCrop } from './crop.ts';

/** The limits of a logo: the source file we take, and the side of the square it becomes. */
export const LOGO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const LOGO_SIDE = 512;
export { LOGO_MAX_BYTES };

export type LogoRefusal = 'not_image' | 'too_large' | 'unreadable' | 'too_large_encoded';

const REFUSALS: Readonly<Record<LogoRefusal, string>> = {
  not_image: 'That file is not an image. Choose a PNG, JPEG or WebP.',
  too_large: 'That image is over 10 MB. Choose a smaller one.',
  unreadable: 'That image could not be read. Try a PNG, JPEG or WebP.',
  too_large_encoded: 'That image stays over 1 MB even scaled down. Try a simpler one.',
};

/** Why a file was not taken as a logo, in plain words. */
export class LogoError extends Error {
  readonly code: LogoRefusal;

  constructor(code: LogoRefusal) {
    super(REFUSALS[code]);
    this.name = 'LogoError';
    this.code = code;
  }
}

/** An image taken as a logo's source, decoded and kept for cropping until released (`releaseLogoSource`). */
export interface LogoSource {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** An object URL of the file, for the cropper's `<img>`. */
  readonly url: string;
  readonly image: ImageBitmap | HTMLImageElement;
}

/** A logo ready to upload: the square `crop` of its source, scaled to fit 512×512 and re-encoded (PNG, or WebP). */
export interface PreparedLogo {
  readonly blob: Blob;
  /** An object URL of `blob` for the preview; whoever keeps the logo releases it (`releaseLogo`). */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly sourceName: string;
  readonly crop: CropRect;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new LogoError('unreadable'));
    image.src = url;
  });
}

/** Decodes with `createImageBitmap` (which applies the EXIF orientation), else through an `<img>` (an SVG). */
async function decode(file: File, url: string): Promise<LogoSource['image']> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return loadImage(url);
  }
}

const sizeOf = (image: LogoSource['image']): readonly [number, number] =>
  image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];

/**
 * Takes an image file as a logo's source: refuses anything but an image, or one over 10 MB, or one that cannot be
 * decoded; the rest is ready to crop.
 */
export async function loadLogoSource(file: File): Promise<LogoSource> {
  if (!file.type.startsWith('image/')) throw new LogoError('not_image');
  if (file.size > LOGO_SOURCE_MAX_BYTES) throw new LogoError('too_large');
  const url = URL.createObjectURL(file);
  try {
    const image = await decode(file, url);
    const [width, height] = sizeOf(image);
    if (width === 0 || height === 0) throw new LogoError('unreadable');
    return { name: file.name, width, height, url, image };
  } catch (failure) {
    URL.revokeObjectURL(url);
    throw failure;
  }
}

/** Frees a source: its URL and its decoded bitmap. */
export function releaseLogoSource(source: LogoSource | null | undefined): void {
  if (!source) return;
  URL.revokeObjectURL(source.url);
  if ('close' in source.image) source.image.close();
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new LogoError('unreadable'))), type, quality);
  });
}

/**
 * The square `crop` of the source as the logo: drawn on a canvas of at most 512×512 (never scaled up; this keeps
 * transparency and drops the metadata), encoded as PNG, or as WebP when the PNG is over 1 MB.
 */
export async function encodeLogo(
  source: LogoSource,
  crop: CropRect = coverCrop(source),
): Promise<PreparedLogo> {
  const side = Math.max(1, Math.min(LOGO_SIDE, Math.round(crop.size)));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new LogoError('unreadable');
  context.drawImage(source.image, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
  let blob = await encode(canvas, 'image/png');
  if (blob.size > LOGO_MAX_BYTES) blob = await encode(canvas, 'image/webp', 0.9);
  if (blob.size > LOGO_MAX_BYTES) throw new LogoError('too_large_encoded');
  return { blob, url: URL.createObjectURL(blob), width: side, height: side, sourceName: source.name, crop };
}

/** Frees a prepared logo's preview URL once nothing shows it any more. */
export function releaseLogo(logo: PreparedLogo | null | undefined): void {
  if (logo) URL.revokeObjectURL(logo.url);
}
