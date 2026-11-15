import { CHAT_IMAGE_BASE64_MAX, CHAT_IMAGE_MAX_BYTES } from '@mwc/shared/chat-images';
import { describe, expect, it } from 'vitest';
import {
  decodeImages,
  IMAGE_ORDER_NOTE,
  imageOrderHeader,
  imageRecords,
  imagesOf,
} from '../../../../src/modules/chats/rules/images.ts';
import { GIF, JPEG, PNG, pngOfSize, SVG, sha256, WEBP } from '../../../fixtures/companies/logos.ts';

const b64 = (bytes: Uint8Array) => ({ data: Buffer.from(bytes).toString('base64') });

describe('decodeImages', () => {
  it('takes PNG, JPEG, WebP and GIF images, told from their bytes, in order', () => {
    const decoded = decodeImages([b64(PNG), b64(JPEG), b64(WEBP), b64(GIF)]);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.images.map((image) => image.contentType)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ]);
    expect(decoded.images[0]).toEqual({ bytes: PNG, contentType: 'image/png', sha256: sha256(PNG) });
    expect(decodeImages([])).toEqual({ ok: true, images: [] });
  });

  it('refuses the first image that is not base64, empty, too large or not an image, saying which', () => {
    expect(decodeImages([b64(PNG), { data: 'not base64!' }])).toMatchObject({
      status: 400,
      code: 'image_invalid',
      message: expect.stringMatching(/^Image 2 /),
    });
    expect(decodeImages([{ data: '' }])).toMatchObject({ code: 'image_invalid' });
    expect(decodeImages([{ data: 'QUJD\nREVG' }])).toMatchObject({ code: 'image_invalid' });
    expect(decodeImages([b64(pngOfSize(CHAT_IMAGE_MAX_BYTES + 1))])).toMatchObject({
      status: 413,
      code: 'image_too_large',
      message: 'Image 1 is too large: the most an image is 3.0 MB',
    });
    expect(decodeImages([{ data: 'A'.repeat(CHAT_IMAGE_BASE64_MAX + 4) }])).toMatchObject({
      status: 413,
      code: 'image_too_large',
    });
    expect(decodeImages([b64(SVG)])).toMatchObject({ status: 415, code: 'image_type_unsupported' });
  });
});

describe('imageRecords and imagesOf', () => {
  it('numbers the rows by position and names each one in the references', () => {
    let n = 0;
    const decoded = decodeImages([b64(PNG), b64(GIF)]);
    if (!decoded.ok) throw new Error('decoded');
    const { refs, rows } = imageRecords(decoded.images, () => `id-${++n}`);
    expect(rows.map((row) => [row.id, row.position, row.size])).toEqual([
      ['id-1', 0, PNG.length],
      ['id-2', 1, GIF.length],
    ]);
    expect(refs).toEqual([
      { id: 'id-1', contentType: 'image/png', size: PNG.length, sha256: sha256(PNG) },
      { id: 'id-2', contentType: 'image/gif', size: GIF.length, sha256: sha256(GIF) },
    ]);
  });

  it('reads a turn’s stored images, and none for null or a value that no longer parses', () => {
    const ref = {
      id: '019a5b2e-0000-7000-8000-000000000001',
      contentType: 'image/png',
      size: 3,
      sha256: sha256(PNG),
    };
    expect(imagesOf({ images: [ref] as never })).toEqual([ref]);
    expect(imagesOf({ images: null })).toEqual([]);
    expect(imagesOf({ images: [{ id: 'x' }] as never })).toEqual([]);
  });
});

describe('imageOrderHeader (T-20)', () => {
  it('says the images come in the order of their [Image N] markers, before a text that marks them', () => {
    expect(IMAGE_ORDER_NOTE).toBe('Images are attached in the order of their [Image N] markers.');
    expect(imageOrderHeader('Compare [Image 1] with [Image 2]', 2)).toBe(`${IMAGE_ORDER_NOTE}\n\n`);
    expect(imageOrderHeader('[Image 12] only', 1)).toBe(`${IMAGE_ORDER_NOTE}\n\n`);
  });

  it('is nothing without images, or without a marker', () => {
    expect(imageOrderHeader('Compare [Image 1] with [Image 2]', 0)).toBe('');
    expect(imageOrderHeader('What is on these?', 2)).toBe('');
    expect(imageOrderHeader('[Image] [image 1] [Image one] Image 1', 2)).toBe('');
  });
});
