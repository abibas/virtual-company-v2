import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX, ChatImageType } from '@mwc/shared/chat-images';
import { ApiError } from '../../../api/errors.ts';

/**
 * Which files a chat message takes as images (T-18): PNG, JPEG, WebP or GIF, at most `CHAT_IMAGES_MAX` a message, each
 * at most `CHAT_IMAGE_MAX_BYTES` once prepared (`fit-image.ts` scales a larger PNG, JPEG or WebP down), and the words
 * for what is refused.
 */

export { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX };

/** Why a file was not attached. */
export type AttachRefusal = 'type' | 'count' | 'gif_too_large' | 'too_large' | 'unreadable' | 'slack';

export const ATTACH_REFUSALS: Readonly<Record<AttachRefusal, string>> = {
  type: 'Only PNG, JPEG, WebP or GIF images can be attached.',
  count: `At most ${CHAT_IMAGES_MAX} images a message.`,
  gif_too_large: 'That GIF is over 3 MB. Attach a smaller one.',
  too_large: 'That image stays over 3 MB even scaled down. Try a smaller one.',
  unreadable: 'That image could not be read. Try a PNG, JPEG or WebP.',
  slack: 'Images go to the agent only: switch to Ask the agent to attach them.',
};

/** A file refused, with its reason. */
export class AttachError extends Error {
  readonly code: AttachRefusal;

  constructor(code: AttachRefusal) {
    super(ATTACH_REFUSALS[code]);
    this.name = 'AttachError';
    this.code = code;
  }
}

const TYPES: ReadonlySet<string> = new Set(ChatImageType.options);

/** True for a file of a type a message takes (the server checks the bytes too). */
export const attachable = (file: Blob): boolean => TYPES.has(file.type);

/** The files of a drop or a paste: its file list, else its file items (a paste in some browsers). */
export function filesOf(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  if (transfer.files.length > 0) return [...transfer.files];
  const files: File[] = [];
  for (const item of transfer.items) {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    if (file) files.push(file);
  }
  return files;
}

/** True when a drag carries files (not text or the page's own elements). */
export const draggingFiles = (transfer: DataTransfer | null): boolean =>
  transfer?.types.includes('Files') === true;

/** The prompt of a message with images and no text (the agent needs some words): "(1 image)", "(3 images)". */
export const imagesPrompt = (count: number): string => `(${count} ${count === 1 ? 'image' : 'images'})`;

/** True for a prompt `imagesPrompt` made: the thread shows the images alone. */
export const isImagesPrompt = (prompt: string): boolean => /^\(\d+ images?\)$/.test(prompt);

/**
 * A message with images refused because the machine's runner is older than them (`runner_outdated`): the server's own
 * words (update it, or send without them), in place of the page's words for a runner too old for chats.
 */
export function imagesRefusal(failure: unknown, attached: number): string | undefined {
  return attached > 0 && failure instanceof ApiError && failure.code === 'runner_outdated'
    ? failure.message
    : undefined;
}
