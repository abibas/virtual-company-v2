import { z } from 'zod';
import { AgentIconContentType } from './enums.ts';

/**
 * Images a person attaches to a chat message (T-18, docs/harness.md "Images in a message"), the contract the server, the
 * web and a runner share. A message carries at most `CHAT_IMAGES_MAX` images of at most `CHAT_IMAGE_MAX_BYTES` each,
 * PNG, JPEG, WebP or GIF as their first bytes show (an agent icon's types). The web sends them with the message as
 * base64; the server keeps them with the turn (`chat_images`) and names them in the turn (`ChatImageRef`: its view, and
 * its spec to the runner), and the runner fetches them before the turn starts.
 */

/** The image types a message takes. */
export const ChatImageType = AgentIconContentType;
export type ChatImageType = AgentIconContentType;

/**
 * The largest image, in bytes: 3 MB (3,145,728 bytes), so its base64 (4 MB) stays under the 5 MB per image the model
 * providers take. The web scales a larger screenshot down to fit before it sends it.
 */
export const CHAT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** The most images one message carries. */
export const CHAT_IMAGES_MAX = 6;

/** The longest base64 text of one image: 4 characters for each 3 bytes, padded. */
export const CHAT_IMAGE_BASE64_MAX = Math.ceil(CHAT_IMAGE_MAX_BYTES / 3) * 4;

/** Each type's file extension (the name a runner gives the file it hands a harness). */
export const CHAT_IMAGE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const satisfies Record<ChatImageType, string>;

/** One image as its turn names it: its id, its type, its size in bytes and its SHA-256 (lower-case hex). */
export const ChatImageRef = z.object({
  id: z.uuid(),
  contentType: ChatImageType,
  size: z.int().min(1).max(CHAT_IMAGE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 in lower-case hex'),
});
export type ChatImageRef = z.infer<typeof ChatImageRef>;

/** A message's images, in the order they were attached. */
export const ChatImageRefs = z.array(ChatImageRef).min(1).max(CHAT_IMAGES_MAX);

/** A turn's stored images (`chat_turns.images`) read back: none for null or a value that no longer parses. */
export function storedImages(value: unknown): ChatImageRef[] {
  const images = ChatImageRefs.safeParse(value);
  return images.success ? images.data : [];
}
