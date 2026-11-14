import { z } from '@hono/zod-openapi';
import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX, ChatImageType } from '@mwc/shared/chat-images';

/**
 * A chat message's images (T-18, docs/harness.md "Images in a message"): what a message sends with its prompt (base64),
 * what its turn shows of them, and the address of one image.
 */

/** The images a message sends with its prompt, in order. */
export const messageImageFields = {
  images: z
    .array(
      z.object({
        data: z.string().openapi({
          description:
            'The image, base64 (the standard alphabet, padded, no `data:` prefix): a PNG, JPEG, WebP or GIF image ' +
            `of at most ${CHAT_IMAGE_MAX_BYTES} bytes, told from its first bytes`,
        }),
      }),
    )
    .min(1)
    .max(CHAT_IMAGES_MAX)
    .optional()
    .openapi({
      description:
        `Images for the agent (at most ${CHAT_IMAGES_MAX}): they go with the prompt (Claude Code: image blocks; Codex: ` +
        '`--image`), and the thread shows them. A message with images sent Now waits for the running turn to end, then ' +
        'starts first',
    }),
};

/** One image as its turn shows it: `GET …/chats/{chatId}/images/{id}` answers its bytes. */
export const ChatImageSchema = z
  .object({
    id: z.string(),
    contentType: ChatImageType,
    size: z.number().int().min(1).openapi({ description: 'Its size in bytes' }),
  })
  .openapi('ChatImage');

/** What a turn shows of its message's images. */
export const turnImageFields = {
  images: z
    .array(ChatImageSchema)
    .openapi({ description: "The message's images, in the order they were attached; none for most turns" }),
};

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

export const ImageParamsSchema = z.object({
  companyId: pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10'),
  chatId: pathParam('chatId', '019a6c1d-2b3c-7d4e-8f5a-6b7c8d9e0f1a'),
  imageId: pathParam('imageId', '019a6c1d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'),
});

/** An image's bytes in the API document. */
export const ImageBytesSchema = z.string().openapi({ type: 'string', format: 'binary' });
