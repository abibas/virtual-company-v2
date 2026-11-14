import { z } from '@hono/zod-openapi';
import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { ChatTurnDelivery, Harness } from '@mwc/shared/enums';
import { AskQuestions, InitEvent, QuestionAnswers } from '@mwc/shared/harness';
import { ChatBranchedFromSchema, chatBranchFields } from './schemas/branch.ts';
import { ChatContextSchema } from './schemas/context.ts';
import { ChatEarlierSchema } from './schemas/history.ts';
import { messageImageFields } from './schemas/images.ts';
import { ChatOverridesSchema, ProfileRunsSchema } from './schemas/overrides.ts';
import { chatPeopleFields } from './schemas/people.ts';
import { chatTaskField } from './schemas/task.ts';
import { ChatTurnWithEventsSchema } from './schemas/turn.ts';

export { ChatContextSchema, type ChatContextView } from './schemas/context.ts';
export {
  ChatEventSchema,
  type ChatEventView,
  type ChatStreamEvent,
  ChatStreamEventSchema,
  type ChatStreamRemoved,
  ChatStreamRemovedSchema,
  type ChatStreamTurn,
  ChatStreamTurnSchema,
  ChatTurnSchema,
  type ChatTurnView,
  ChatTurnWithEventsSchema,
  type ChatTurnWithEventsView,
} from './schemas/turn.ts';

/**
 * The chats' shapes (S5.1b, docs/harness.md "How a turn runs"): a chat with an agent, the bodies that create and change
 * it and its turns; the turns with their events and the stream's messages are `schemas/turn.ts`.
 */

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

const COMPANY = pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10');

export const AgentChatsParamsSchema = z.object({
  companyId: COMPANY,
  agentId: pathParam('agentId', '019a4f0c-c4d5-7e6f-8a7b-9c0d1e2f3a4b'),
});

export const ChatParamsSchema = z.object({
  companyId: COMPANY,
  chatId: pathParam('chatId', '019a6c1d-2b3c-7d4e-8f5a-6b7c8d9e0f1a'),
});

export const TurnParamsSchema = ChatParamsSchema.extend({
  turnId: pathParam('turnId', '019a6c1d-9e8f-7a6b-8c5d-4e3f2a1b0c9d'),
});

const dateTime = z.string().openapi({ format: 'date-time' });

/** A chat as lists show it. */
export const ChatSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    harness: Harness,
    machineId: z
      .string()
      .openapi({ description: "The agent's machine when the chat began: its session lives there" }),
    profileId: z
      .string()
      .nullable()
      .openapi({ description: "This chat's own access profile; null: the agent's" }),
    profileSetBy: z.string().nullable().openapi({ description: 'The person (user id) who chose it' }),
    sessionId: z
      .string()
      .nullable()
      .openapi({ description: "The harness's conversation; null before the first turn" }),
    title: z
      .string()
      .nullable()
      .openapi({ description: "The first prompt's start; null before the first turn" }),
    ...chatBranchFields,
    task: z
      .object({
        taskId: z.string(),
        stepId: z.string().openapi({ description: 'The step (a removed step keeps its id here)' }),
        round: z.number().int().min(1).openapi({ description: 'The round of the step it began in' }),
      })
      .nullable()
      .openapi({
        description:
          "A task's conversation at one of its steps (S5.3b): in the agent's chat list apart from its chats (`tasks`, " +
          'T-19), and opened from the task; null for a chat begun with the agent',
      }),
    flowId: z.string().nullable().openapi({
      description:
        "A flow's team chat with its Lead agent (S6c): the flow whose events wake the Lead here; null for any other chat",
    }),
    overrides: ChatOverridesSchema,
    createdBy: z.string().openapi({ description: 'The principal who began it' }),
    createdAt: dateTime,
    updatedAt: dateTime,
    archivedAt: dateTime.nullable(),
  })
  .openapi('Chat');

/** The question the agent asked that waits for the person (S5.2 step 4, `rules/questions.ts`). */
export const OpenQuestionSchema = z
  .object({
    turnId: z.string().openapi({ description: 'The turn that asked it' }),
    id: z
      .string()
      .openapi({ description: "The question's id (its `question` event's), which the answer names" }),
    questions: AskQuestions,
  })
  .openapi('OpenQuestion');

export const ChatDetailSchema = ChatSchema.extend({
  turns: z.array(ChatTurnWithEventsSchema).openapi({
    description:
      "The current conversation: the turns since the chat's last Clear (that Clear's turn first), the latest 30 of them",
  }),
  earlier: ChatEarlierSchema,
  branchedFrom: ChatBranchedFromSchema.nullable().openapi({
    description: 'The chat it branched from; null: none',
  }),
  /** The last `init` event since the chat's last Clear (model, effort, folder, slash commands); null before one. */
  init: InitEvent.nullable(),
  context: ChatContextSchema.nullable().openapi({
    description: "How full the conversation is since the chat's last Clear; null before anything measured it",
  }),
  queue: z.array(z.string()).openapi({
    description:
      "The waiting turns' ids in the order they start (Now and interrupting ones first, then the rest, oldest first)",
  }),
  profileRuns: ProfileRunsSchema.nullable().openapi({
    description:
      "The mode, model and effort of the profile the chat runs on (its own, else its agent's), for its harness; null " +
      'without one',
  }),
  question: OpenQuestionSchema.nullable().openapi({
    description:
      "The latest question of the chat's last turn while it is not answered; null when there is none (a newer turn " +
      'or a plain message closes it)',
  }),
  runnerUpdateFor: z
    .string()
    .nullable()
    .openapi({
      example: 'Jira and Confluence',
      description:
        "What the chat's profile gives of the server's tools that its machine's runner is too old to provide (no " +
        '`caps.serverTools`), in a few words; null when nothing waits for a runner update or the runner is offline',
    }),
  ...chatPeopleFields,
  ...chatTaskField,
}).openapi('ChatDetail');

/** A page of older turns (`GET …/chats/{chatId}/turns`), in order, and whether older ones exist in its range. */
export const OlderTurnsSchema = z
  .object({ turns: z.array(ChatTurnWithEventsSchema), more: z.boolean() })
  .openapi('ChatOlderTurns');

/** A new title, and this chat's own access profile (the caller's own) or null for the agent's. */
export const UpdateChatSchema = z
  .object({
    title: z.string().trim().min(CHAT_TITLE.min).max(CHAT_TITLE.max).optional(),
    profileId: z.string().nullable().optional(),
  })
  .openapi('UpdateChat');

const Prompt = z.string().min(CHAT_PROMPT.min).max(CHAT_PROMPT.max);

export const CreateTurnSchema = z
  .object({
    prompt: Prompt,
    ...messageImageFields,
    delivery: ChatTurnDelivery.optional().openapi({
      description:
        'While a turn runs: `now` (into it: Claude Code only), `after` (queued for its end) or `interrupt` (stop it, ' +
        'start this). Left out, a running turn refuses the prompt (`turn_running`)',
    }),
    startMachine: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Start the agent's machine when it is stopped, whatever its policy's start on a message says (an admin or " +
          "owner's Start and send); the turn then waits for it (`machineWaitAt`)",
      }),
  })
  .openapi('CreateTurn');

/** A waiting message's new prompt. */
export const EditTurnSchema = z.object({ prompt: Prompt }).openapi('EditTurn');

/** Sends a waiting message into the running turn now, or makes it interrupt the running turn. */
export const DeliverTurnSchema = z.object({ delivery: z.enum(['now', 'interrupt']) }).openapi('DeliverTurn');

/** The person's answers to the open question: one per question at most (none of a question: skipped). */
export const AnswerQuestionSchema = z
  .object({
    questionId: z.string().min(1).openapi({ description: "The open question's id" }),
    answers: QuestionAnswers,
  })
  .openapi('AnswerQuestion');

export type ChatView = z.infer<typeof ChatSchema>;
export type ChatDetailView = z.infer<typeof ChatDetailSchema>;
export type UpdateChat = z.infer<typeof UpdateChatSchema>;
export type AnswerQuestion = z.infer<typeof AnswerQuestionSchema>;
