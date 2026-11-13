import { z } from '@hono/zod-openapi';
import { ChatSchema, ChatTurnSchema } from '../schemas.ts';

/** The company's chats, live (2026-11-13, `service/activity.ts`): one chat as it is now, with its latest turn. */

export const ChatActivityParamsSchema = z.object({
  companyId: z.string().openapi({
    param: { name: 'companyId', in: 'path' },
    example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  }),
});

export const ChatActivitySchema = z
  .object({
    chat: ChatSchema,
    lastTurn: ChatTurnSchema.nullable().openapi({ description: 'Its latest turn; null before its first' }),
  })
  .openapi('ChatActivity');

export type ChatActivityView = z.infer<typeof ChatActivitySchema>;
