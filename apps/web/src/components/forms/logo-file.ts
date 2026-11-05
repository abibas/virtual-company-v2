/** The limits of a logo: the source file we take, the side it is scaled to fit, and the encoded size the server takes. */
export const LOGO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_SIDE = 512;

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

/** A logo ready to upload: scaled to fit 512×512 and re-encoded (PNG, or WebP when the PNG is over 1 MB). */
export interface PreparedLogo {
  readonly blob: Blob;
  /** An object URL of `blob` for the preview; whoever keeps the logo releases it (`releaseLogo`). */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly sourceName: string;
}

type Decoded = ImageBitmap | HTMLImageElement;

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new LogoError('unreadable'));
    };
    image.src = url;
  });
}

/** Decodes with `createImageBitmap` (which applies the EXIF orientation), else through an `<img>` (an SVG). */
async function decode(file: File): Promise<Decoded> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return loadImage(file);
  }
}

const sizeOf = (source: Decoded): readonly [number, number] =>
  source instanceof HTMLImageElement
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new LogoError('unreadable'))), type, quality);
  });
}

/**
 * Takes an image file as a logo: refuses anything but an image, or one over 10 MB; scales it to fit 512×512 on a
 * canvas (which keeps transparency and drops the metadata); encodes it as PNG, or as WebP when the PNG is over 1 MB.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (!file.type.startsWith('image/')) throw new LogoError('not_image');
  if (file.size > LOGO_SOURCE_MAX_BYTES) throw new LogoError('too_large');
  const source = await decode(file);
  const [sourceWidth, sourceHeight] = sizeOf(source);
  if (sourceWidth === 0 || sourceHeight === 0) throw new LogoError('unreadable');
  const scale = Math.min(1, LOGO_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new LogoError('unreadable');
  context.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();
  let blob = await encode(canvas, 'image/png');
  if (blob.size > LOGO_MAX_BYTES) blob = await encode(canvas, 'image/webp', 0.9);
  if (blob.size > LOGO_MAX_BYTES) throw new LogoError('too_large_encoded');
  return { blob, url: URL.createObjectURL(blob), width, height, sourceName: file.name };
}

/** Frees a prepared logo's preview URL once nothing shows it any more. */
export function releaseLogo(logo: PreparedLogo | null | undefined): void {
  if (logo) URL.revokeObjectURL(logo.url);
}

/** The file name of a prepared logo as it is uploaded, from what it was encoded as. */
export function logoFileName(logo: PreparedLogo): string {
  return logo.blob.type === 'image/webp' ? 'logo.webp' : 'logo.png';
}
