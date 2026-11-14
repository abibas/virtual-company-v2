import { describe, expect, it } from 'vitest';
import {
  CHAT_IMAGE_BASE64_MAX,
  CHAT_IMAGE_EXTENSIONS,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGES_MAX,
  ChatImageRefs,
  ChatImageType,
  storedImages,
} from '../src/chat-images.ts';

const REF = {
  id: '019a5b2e-0000-7000-8000-000000000001',
  contentType: 'image/png',
  size: 120,
  sha256: 'a'.repeat(64),
} as const;

describe('chat images (T-18)', () => {
  it("takes an agent icon's types, 6 images of 3 MB at most, and gives each type its extension", () => {
    expect(ChatImageType.options).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect([CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX, CHAT_IMAGE_BASE64_MAX]).toEqual([3_145_728, 6, 4_194_304]);
    expect(Object.values(CHAT_IMAGE_EXTENSIONS)).toEqual(['png', 'jpg', 'webp', 'gif']);
  });

  it('reads stored images back, and none for null, an empty list or a value that no longer parses', () => {
    expect(storedImages([REF])).toEqual([REF]);
    expect(storedImages(null)).toEqual([]);
    expect(storedImages([])).toEqual([]);
    expect(storedImages([{ ...REF, sha256: 'nope' }])).toEqual([]);
    expect(ChatImageRefs.safeParse(Array(CHAT_IMAGES_MAX + 1).fill(REF)).success).toBe(false);
    expect(ChatImageRefs.safeParse([{ ...REF, size: CHAT_IMAGE_MAX_BYTES + 1 }]).success).toBe(false);
  });
});
