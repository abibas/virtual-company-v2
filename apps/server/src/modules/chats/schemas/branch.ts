import { z } from '@hono/zod-openapi';

/**
 * A branch's shapes (docs/harness.md "Branching"): the fields every chat has about where it branched from, the parent
 * its detail names, and the body that branches a chat from one of its replies.
 */

/** The fields of a chat about its branch (all null and false for a chat begun anew). */
export const chatBranchFields = {
  branchedFromChatId: z.string().nullable().openapi({
    description: 'The chat this one branched from; null for a chat begun anew (or a parent gone)',
  }),
  branchedFromTurnId: z
    .string()
    .nullable()
    .openapi({ description: "The parent's turn whose reply this branch continues from" }),
  forkPending: z.boolean().openapi({
    description:
      "True until the branch's first turn forked the parent's session (`sessionId` is the parent's until then; its " +
      'terminal opens after that turn)',
  }),
};

/** The parent a branch's detail names, for its "Branched from" line. */
export const ChatBranchedFromSchema = z
  .object({
    chatId: z.string(),
    turnId: z.string().nullable(),
    title: z.string().nullable().openapi({ description: "The parent's title now" }),
  })
  .openapi('ChatBranchedFrom');

/** A reply of the chat to branch from: one of its finished message turns. */
export const BranchChatSchema = z
  .object({
    turnId: z.string().min(1).openapi({ description: 'The turn whose reply the branch continues from' }),
  })
  .openapi('BranchChat');

export type ChatBranchedFromView = z.infer<typeof ChatBranchedFromSchema>;
export type BranchChat = z.infer<typeof BranchChatSchema>;
