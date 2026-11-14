import { createHash } from 'node:crypto';
import type { ChatTurn } from '@mwc/db';
import {
  CHAT_IMAGE_BASE64_MAX,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGES_MAX,
  type ChatImageRef,
  type ChatImageType,
  storedImages,
} from '@mwc/shared/chat-images';
import { detectIconType } from '../../org/rules/icons.ts';
import { refuse } from '../rules.ts';

// The images of a chat message (T-18, docs/harness.md "Images in a message"): what the web sends (base64), checked and
// told from their first bytes, what the turn names of them, and why a message's images are refused. Pure.

/** One image of a message as the server took it: its bytes, the type they show and their SHA-256. */
export interface MessageImage {
  readonly bytes: Uint8Array;
  readonly contentType: ChatImageType;
  readonly sha256: string;
}

/** Why a message's images are refused, answered in the common error shape. */
export interface ImageRefusal {
  readonly ok: false;
  readonly status: 400 | 413 | 415;
  readonly code: 'image_invalid' | 'image_too_large' | 'image_type_unsupported' | 'message_too_large';
  readonly message: string;
}

const refusal = (status: ImageRefusal['status'], code: ImageRefusal['code'], message: string) =>
  ({ ok: false, status, code, message }) as const satisfies ImageRefusal;

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

/** Room for the prompt and the JSON around the images in a message's body (a 20 000-character prompt is 80 kB at most). */
export const MESSAGE_BODY_ALLOWANCE = 256 * 1024;

/** The largest body of a message: its images' base64 at their limit, and the allowance. */
export const MESSAGE_BODY_MAX = CHAT_IMAGES_MAX * CHAT_IMAGE_BASE64_MAX + MESSAGE_BODY_ALLOWANCE;

/** A body over `MESSAGE_BODY_MAX`, refused before it is read. */
export const MESSAGE_TOO_LARGE = refusal(
  413,
  'message_too_large',
  `The message with its images is over ${mb(MESSAGE_BODY_MAX)}`,
);

/** Base64 as the web sends it: the standard alphabet, padded, no line breaks and no `data:` prefix. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * One image's base64, checked (see above); its bytes and type, or why not. Its length alone says whether it is too
 * large: base64 of at most `CHAT_IMAGE_BASE64_MAX` characters is at most `CHAT_IMAGE_MAX_BYTES` bytes.
 */
function decodeOne(data: string, n: number): MessageImage | ImageRefusal {
  if (data.length > CHAT_IMAGE_BASE64_MAX)
    return refusal(
      413,
      'image_too_large',
      `Image ${n} is too large: the most an image is ${mb(CHAT_IMAGE_MAX_BYTES)}`,
    );
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data))
    return refusal(400, 'image_invalid', `Image ${n} is not base64 (no "data:" prefix, no line breaks)`);
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  const contentType = detectIconType(bytes);
  if (contentType === undefined)
    return refusal(415, 'image_type_unsupported', `Image ${n} is not a PNG, JPEG, WebP or GIF image`);
  return { bytes, contentType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** A message's images from their base64, in order; or why one is refused (the first such). */
export function decodeImages(
  inputs: readonly { readonly data: string }[],
): { readonly ok: true; readonly images: MessageImage[] } | ImageRefusal {
  const images: MessageImage[] = [];
  for (const [i, input] of inputs.entries()) {
    const image = decodeOne(input.data, i + 1);
    if ('ok' in image) return image;
    images.push(image);
  }
  return { ok: true, images };
}

/** What a turn keeps of its message's images: the references it names (`chat_turns.images`) and the rows of bytes. */
export function imageRecords(images: readonly MessageImage[], newId: () => string) {
  const rows = images.map((image, position) => ({
    id: newId(),
    position,
    contentType: image.contentType,
    bytes: image.bytes,
    size: image.bytes.length,
    sha256: image.sha256,
  }));
  const refs: ChatImageRef[] = rows.map(({ id, contentType, size, sha256 }) => ({
    id,
    contentType,
    size,
    sha256,
  }));
  return { refs, rows };
}

/** The images a turn names, in order (none for a turn without). */
export const imagesOf = (turn: Pick<ChatTurn, 'images'>): ChatImageRef[] => storedImages(turn.images);

/** A message with images for a machine whose runner cannot fetch them (one older than T-18). */
export const RUNNER_NO_IMAGES = refuse(
  409,
  'runner_outdated',
  "The agent's machine runs an older runner that cannot take images: update it on the machine's card, or send the " +
    'message without them',
);
