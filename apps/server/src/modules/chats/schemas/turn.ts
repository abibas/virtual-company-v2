import { z } from '@hono/zod-openapi';
import { ChatTurnDelivery, ChatTurnKind, ChatTurnStatus, MachineWait } from '@mwc/shared/enums';
import { TurnEvent } from '@mwc/shared/harness';
import { turnImageFields } from './images.ts';
import { turnRunFields } from './overrides.ts';
import { turnSenderFields } from './sender.ts';

/**
 * A chat's turns (S5.1b, docs/harness.md "How a turn runs"): a turn with its events, and the stream's messages
 * (Server-Sent Events, described here for the web).
 */

const dateTime = z.string().openapi({ format: 'date-time' });

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
        "`message` (a person's prompt), `compact` (the harness's own `/compact`), `clear` (no process: the chat's " +
        'next turn starts a new conversation; the thread shows it as a marker), `people` (no process: a quiet line of ' +
        'who joined or left) or `slack` (no process: a message sent straight into the Slack conversation)',
    }),
    prompt: z.string(),
    status: ChatTurnStatus,
    delivery: ChatTurnDelivery.nullable().openapi({
      description:
        'How a message sent while a turn ran was to reach the agent: `now` (into the running turn; it waits, ' +
        'unchangeable, until the turn takes it, then goes, else starts first), `after` (once the running turn ends) or ' +
        '`interrupt` (the running turn was stopped; it starts first). Null: it started at once',
    }),
    system: z.boolean().openapi({
      description:
        "Queued by Most Wanted itself, not by a person (S6c: a Lead's wake-up); `createdBy` is then the agent",
    }),
    ...turnSenderFields,
    ...turnImageFields,
    profileId: z.string().nullable(),
    credentialId: z
      .string()
      .nullable()
      .openapi({ description: 'The subscription it ran on (never its secret)' }),
    ...turnRunFields,
    startedAt: dateTime.nullable(),
    endedAt: dateTime.nullable(),
    resultText: z.string().nullable().openapi({ description: "The reply: the result's text" }),
    error: z.string().nullable(),
    machineWaitAt: dateTime.nullable().openapi({
      description:
        'Since when a `queued` turn waits for its machine (docs/harness.md "When the machine is stopped", "Waiting ' +
        'for a free slot"): it starts once the machine\'s runner connects, or a turn there ends; null for any other turn',
    }),
    machineWait: MachineWait.nullable().openapi({
      description:
        'What a turn waiting for its machine waits for: to start (`stopped`), or a free slot (`slots`)',
    }),
    detached: z
      .boolean()
      .optional()
      .openapi({
        description:
          "True while a running turn's runner is away (its link dropped, or the server restarted) and the turn waits " +
          'for it to come back with it (docs/harness.md "Surviving restarts"); left out otherwise',
      }),
    detachedAt: dateTime.optional().openapi({
      description:
        'While `detached`: since when its runner is away, as this server saw the link drop (2026-11-12); left out when ' +
        'not known (the server restarted and has not taken the turn back yet) and while attached',
    }),
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

export type ChatTurnView = z.infer<typeof ChatTurnSchema>;
export type ChatEventView = z.infer<typeof ChatEventSchema>;
export type ChatTurnWithEventsView = z.infer<typeof ChatTurnWithEventsSchema>;

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
