import { z } from '@hono/zod-openapi';
import { CHAT_PAGE, CHAT_WINDOW } from '@mwc/shared/chats';

/**
 * A long chat's shapes (docs/harness.md "Reading a long chat"): what the chat's detail leaves out (`earlier`: the older
 * turns of its current conversation and the conversations before each Clear) and the query of the older turns' route.
 */

const dateTime = z.string().openapi({ format: 'date-time' });

/** One conversation before a Clear, as a folded bar shows it; its turns load with `GET …/turns`. */
export const ChatConversationSchema = z
  .object({
    clearTurnId: z.string().openapi({ description: 'The Clear that ended it' }),
    clearSeq: z
      .number()
      .int()
      .min(1)
      .openapi({
        description:
          "The Clear's turn number: its turns are those before it and after the next older conversation's `clearSeq` " +
          '(the `beforeSeq` and `afterSeq` of `GET …/turns`)',
      }),
    clearedAt: dateTime,
    turns: z.number().int().min(0).openapi({ description: 'How many turns it holds (the Clears left out)' }),
    from: dateTime.nullable().openapi({ description: 'When its first turn began; null without a turn' }),
    to: dateTime.nullable().openapi({ description: 'When its last turn began; null without a turn' }),
  })
  .openapi('ChatConversation');

/** What the chat's detail does not hold. */
export const ChatEarlierSchema = z
  .object({
    before: z
      .number()
      .int()
      .min(1)
      .nullable()
      .openapi({
        description:
          "The first returned turn's number while older turns of the current conversation are left out (the " +
          '`beforeSeq` that loads them); null when the detail holds the whole current conversation',
      }),
    turns: z
      .number()
      .int()
      .min(0)
      .openapi({
        description: `How many older turns of the current conversation are left out (the detail holds its latest ${CHAT_WINDOW})`,
      }),
    conversations: z.array(ChatConversationSchema).openapi({
      description: 'The conversations before each Clear, newest first; none of their turns are in the detail',
    }),
  })
  .openapi('ChatEarlier');

export const OlderTurnsQuerySchema = z.object({
  beforeSeq: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: 'beforeSeq', in: 'query' },
      example: 31,
      description: 'The turns before this number (exclusive)',
    }),
  afterSeq: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({
      param: { name: 'afterSeq', in: 'query' },
      example: 0,
      description: 'And after this one (exclusive; default 0), so a page stays inside one conversation',
    }),
  limit: z.coerce
    .number()
    .int()
    .min(CHAT_PAGE.min)
    .max(CHAT_PAGE.max)
    .default(CHAT_PAGE.default)
    .openapi({ param: { name: 'limit', in: 'query' }, example: CHAT_PAGE.default }),
});

export type ChatEarlierView = z.infer<typeof ChatEarlierSchema>;
export type ChatConversationView = z.infer<typeof ChatConversationSchema>;
export type OlderTurnsQuery = z.infer<typeof OlderTurnsQuerySchema>;
