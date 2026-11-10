import { z } from '@hono/zod-openapi';
import { AGENT_EMOJI_MAX, isAgentEmoji } from '@mwc/shared/agent-icons';

/**
 * The org API's shapes of an agent's icon (docs/architecture.md, "Agent icons"): the icon as agents and the chart show
 * it, the face or emoji a `PATCH .../icon` chooses, and the image a `PUT .../icon` uploads.
 */

const Face = z.object({ kind: z.literal('face') });

/** An agent's icon: its drawn face (`face`), an emoji, or its uploaded image by its version. */
export const AgentIconSchema = z
  .discriminatedUnion('kind', [
    Face,
    z.object({ kind: z.literal('emoji'), emoji: z.string().openapi({ example: '🤖' }) }),
    z.object({
      kind: z.literal('image'),
      version: z.string().openapi({
        example: '9f86d081884c7d65',
        description:
          'The first 16 hex characters of the image SHA-256; changes with the image (`GET .../icon?v=`)',
      }),
    }),
  ])
  .openapi('AgentIcon');

/** `PATCH .../icon`: back to the drawn face, or one emoji (its image, if any, is removed). */
export const SetAgentIconSchema = z
  .discriminatedUnion('kind', [
    Face,
    z.object({
      kind: z.literal('emoji'),
      emoji: z
        .string()
        .trim()
        .refine(isAgentEmoji, `One emoji: a single character of at most ${AGENT_EMOJI_MAX} code points`)
        .openapi({ example: '🤖' }),
    }),
  ])
  .openapi('SetAgentIcon');

/** `PUT .../icon`: a multipart form with one file, `file` (its declared type and name are not trusted). */
export const IconUploadSchema = z
  .object({
    file: z.instanceof(File).openapi({
      type: 'string',
      format: 'binary',
      description: 'A PNG, JPEG, WebP or GIF image of at most 1 MB, told by its first bytes',
    }),
  })
  .openapi('AgentIconUpload');

/** The icon after a change. */
export const AgentIconResultSchema = z.object({ icon: AgentIconSchema }).openapi('AgentIconResult');

export type AgentIconSchemaView = z.infer<typeof AgentIconSchema>;
export type SetAgentIcon = z.infer<typeof SetAgentIconSchema>;
