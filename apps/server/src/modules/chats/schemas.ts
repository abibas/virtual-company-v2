import { z } from '@hono/zod-openapi';
import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { ChatTurnDelivery, ChatTurnKind, ChatTurnStatus, Harness } from '@mwc/shared/enums';
import { AskQuestions, InitEvent, QuestionAnswers, TurnEvent } from '@mwc/shared/harness';
import { ChatEarlierSchema } from './schemas/history.ts';

/**
 * The chats' shapes (S5.1b, docs/harness.md "How a turn runs"): a chat with an agent, its turns and their events, the
 * bodies that create and change them, and the stream's messages (Server-Sent Events, described here for the web).
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
    createdBy: z.string().openapi({ description: 'The principal who began it' }),
    createdAt: dateTime,
    updatedAt: dateTime,
    archivedAt: dateTime.nullable(),
  })
  .openapi('Chat');

/** One event of a turn, as the runner read it. */
export const ChatEventSchema = z
  .object({
    seq: z.number().int().min(1),
    event: TurnEvent,
    at: dateTime,
  })
  .openapi('ChatEvent');

/** A turn: the prompt, how far it got, what it ran on, and how it ended. */
export const ChatTurnSchema = z
  .object({
    id: z.string(),
    chatId: z.string(),
    seq: z.number().int().min(1),
    kind: z.enum(ChatTurnKind.options).openapi({
      description:
        "`message` (a person's prompt), `compact` (the harness's own `/compact`) or `clear` (no process: the chat's " +
        'next turn starts a new conversation; the thread shows it as a marker)',
    }),
    prompt: z.string(),
    status: ChatTurnStatus,
    delivery: ChatTurnDelivery.nullable().openapi({
      description:
        'How a message sent while a turn ran was to reach the agent: `now` (into the running turn; it waits, ' +
        'unchangeable, until the turn takes it, then goes, else starts first), `after` (once the running turn ends) or ' +
        '`interrupt` (the running turn was stopped; it starts first). Null: it started at once',
    }),
    profileId: z.string().nullable(),
    credentialId: z
      .string()
      .nullable()
      .openapi({ description: 'The subscription it ran on (never its secret)' }),
    startedAt: dateTime.nullable(),
    endedAt: dateTime.nullable(),
    resultText: z.string().nullable().openapi({ description: "The reply: the result's text" }),
    error: z.string().nullable(),
    usage: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({
        description:
          '`{inputTokens, outputTokens, cachedInputTokens?, costUsd?, includedInPlan?}`; `includedInPlan`: it ran on ' +
          'a login or setup token, so it cost nothing beyond the plan',
      }),
    createdBy: z.string(),
    createdAt: dateTime,
  })
  .openapi('ChatTurn');

export const ChatTurnWithEventsSchema = ChatTurnSchema.extend({ events: z.array(ChatEventSchema) }).openapi(
  'ChatTurnWithEvents',
);

/** How full the chat's conversation is, for its context meter (`rules.ts`, `chatContext`). */
export const ChatContextSchema = z
  .object({
    usedTokens: z
      .number()
      .int()
      .min(0)
      .openapi({
        description:
          "The conversation's size: the last request's input, cache reads and cache writes, or the size after a later " +
          'compaction',
      }),
    window: z
      .number()
      .int()
      .min(1)
      .nullable()
      .openapi({ description: "The model's context window; null: unknown" }),
    model: z.string().nullable().openapi({ description: 'The model the last `init` named' }),
    at: dateTime.openapi({ description: 'When it was measured: the time of the event it comes from' }),
    estimate: z.literal(true).optional().openapi({
      description: "Estimated from a turn's total usage (Codex): a turn of several model calls reads high",
    }),
  })
  .openapi('ChatContext');

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
  /** The last `init` event since the chat's last Clear (model, effort, folder, slash commands); null before one. */
  init: InitEvent.nullable(),
  context: ChatContextSchema.nullable().openapi({
    description: "How full the conversation is since the chat's last Clear; null before anything measured it",
  }),
  queue: z.array(z.string()).openapi({
    description:
      "The waiting turns' ids in the order they start (Now and interrupting ones first, then the rest, oldest first)",
  }),
  question: OpenQuestionSchema.nullable().openapi({
    description:
      "The latest question of the chat's last turn while it is not answered; null when there is none (a newer turn " +
      'or a plain message closes it)',
  }),
}).openapi('ChatDetail');

/** A page of older turns (`GET …/chats/{chatId}/turns`), in order, and whether older ones exist in its range. */
export const OlderTurnsSchema = z
  .object({ turns: z.array(ChatTurnWithEventsSchema), more: z.boolean() })
  .openapi('ChatOlderTurns');

export const ChatListSchema = z.object({ chats: z.array(ChatSchema) }).openapi('ChatList');

/** A new chat, with this chat's own access profile (only the caller's own) when given. */
export const CreateChatSchema = z
  .object({ profileId: z.string().nullable().optional() })
  .openapi('CreateChat');

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
    delivery: ChatTurnDelivery.optional().openapi({
      description:
        'While a turn runs: `now` (into it: Claude Code only), `after` (queued for its end) or `interrupt` (stop it, ' +
        'start this). Left out, a running turn refuses the prompt (`turn_running`)',
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
export type ChatTurnView = z.infer<typeof ChatTurnSchema>;
export type ChatEventView = z.infer<typeof ChatEventSchema>;
export type ChatDetailView = z.infer<typeof ChatDetailSchema>;
export type ChatTurnWithEventsView = z.infer<typeof ChatTurnWithEventsSchema>;
export type ChatContextView = z.infer<typeof ChatContextSchema>;
export type CreateChat = z.infer<typeof CreateChatSchema>;
export type UpdateChat = z.infer<typeof UpdateChatSchema>;
export type AnswerQuestion = z.infer<typeof AnswerQuestionSchema>;

/**
 * The stream's messages (`GET …/chats/{chatId}/stream`, `text/event-stream`): `event: turn` with `{turn}` when a turn
 * starts or changes status, `event: event` with `{turnId, turnSeq, seq, event, at}` for each event (its `id:` is
 * `<turnSeq>.<seq>`, which `Last-Event-ID` sends back), `event: removed` with `{turnId}` when a waiting message goes
 * (discarded, or taken into the running turn; S5.2 step 6), and a `: heartbeat` comment every 20 s.
 */
export const ChatStreamTurnSchema = z.object({ turn: ChatTurnSchema });
export const ChatStreamEventSchema = z.object({
  turnId: z.string(),
  turnSeq: z.number().int().min(1),
  seq: z.number().int().min(1),
  event: TurnEvent,
  at: dateTime,
});
export const ChatStreamRemovedSchema = z.object({ turnId: z.string() });
export type ChatStreamTurn = z.infer<typeof ChatStreamTurnSchema>;
export type ChatStreamRemoved = z.infer<typeof ChatStreamRemovedSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
