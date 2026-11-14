import { z } from '@hono/zod-openapi';
import { ChatSchema, ChatTurnSchema } from '../schemas.ts';
import { ChatPersonSchema } from './people.ts';

/**
 * An agent's chat lists: a chat as a list shows it (since 2026-11-14 with its people's faces and its latest turn, for
 * its dot and its place), the list itself, and the company's chats, live (2026-11-13, `service/activity.ts`): one chat
 * as it is now, with its latest turn.
 */

export const ChatListItemSchema = ChatSchema.extend({
  people: z.array(ChatPersonSchema).openapi({
    description: 'Who is in it (members and contacts), the earliest added first; empty for a team chat',
  }),
  lastTurn: ChatTurnSchema.nullable().openapi({
    description:
      'Its latest turn that talks with the agent (no line of who joined or left, no message sent in Slack); null ' +
      'before its first',
  }),
}).openapi('ChatListItem');

export const ChatListSchema = z.object({ chats: z.array(ChatListItemSchema) }).openapi('ChatList');

export const ChatActivityParamsSchema = z.object({
  companyId: z.string().openapi({
    param: { name: 'companyId', in: 'path' },
    example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  }),
});

export const ChatActivitySchema = z
  .object({
    chat: ChatListItemSchema,
    lastTurn: ChatTurnSchema.nullable().openapi({
      description: "Its latest turn that talks with the agent (as the chat's own); null before its first",
    }),
  })
  .openapi('ChatActivity');

export type ChatActivityView = z.infer<typeof ChatActivitySchema>;
export type ChatListItemView = z.infer<typeof ChatListItemSchema>;
