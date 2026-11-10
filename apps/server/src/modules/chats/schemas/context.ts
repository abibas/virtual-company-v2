import { z } from '@hono/zod-openapi';

/** The chat's context meter's reading in its detail (docs/harness.md, "Compact and Clear"). */

const dateTime = z.string().openapi({ format: 'date-time' });

/** How full the chat's conversation is, for its context meter (`rules/conversation.ts`, `conversationState`). */
export const ChatContextSchema = z
  .object({
    usedTokens: z
      .number()
      .int()
      .min(0)
      .openapi({
        description:
          "The conversation's size: the size the harness counts when it says (Codex's own reading), else the last " +
          "request's input, cache reads and cache writes, or the size after a later compaction",
      }),
    window: z
      .number()
      .int()
      .min(1)
      .nullable()
      .openapi({ description: "The model's context window; null: unknown" }),
    model: z
      .string()
      .nullable()
      .openapi({ description: 'The model the reading names (Codex), else the one the last `init` named' }),
    at: dateTime.openapi({ description: 'When it was measured: the time of the event it comes from' }),
    estimate: z
      .literal(true)
      .optional()
      .openapi({
        description:
          "Estimated from a turn's total usage (Codex, when its own reading could not be read): a turn of several model " +
          'calls reads high',
      }),
    baselineTokens: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({
        description:
          "Tokens the harness leaves out of its own percentage (Codex's 12k): the share is (used − baseline) / " +
          '(window − baseline)',
      }),
  })
  .openapi('ChatContext');

export type ChatContextView = z.infer<typeof ChatContextSchema>;
