import { z } from '@hono/zod-openapi';
import { RoomMessageKind, StepEndAction } from '@mwc/shared/enums';
import { ROOM, ROOM_MESSAGE_MAX, ROOM_PAGE } from '@mwc/shared/flows';
import { At, PrincipalRefSchema } from '../schemas.ts';

// A flow's team room (docs/processes.md "The team room"): its feed, a person's message, and its cap's setting.

/** A page of the feed: the latest messages, or those before a cursor (`nextBefore` of the page after it). */
export const RoomQuerySchema = z.object({
  before: z
    .string()
    .optional()
    .openapi({ description: "A page's `nextBefore`: the messages written before it" }),
  limit: z.coerce.number().int().min(1).max(ROOM_PAGE.max).optional().openapi({ example: ROOM_PAGE.default }),
});

/** A person's message in the room. */
export const RoomPostSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(ROOM_MESSAGE_MAX)
      .openapi({ example: '@Developer is T-2 ready for review?' }),
  })
  .openapi('RoomPost');

/** The room's cap: the answers its people's messages may ask of its agents in an hour. */
export const RoomSettingsSchema = z
  .object({ maxPerHour: z.number().int().min(ROOM.maxPerHour.min).max(ROOM.maxPerHour.max) })
  .openapi('RoomSettings');

/** A step-end line's move: what the agent did, the step, where the task went, the round and its words. */
const StepEndSchema = z.object({
  action: StepEndAction,
  from: z.string(),
  to: z.string().nullable(),
  round: z.number().int(),
  words: z.string(),
});

export const RoomMessageSchema = z
  .object({
    id: z.string(),
    kind: RoomMessageKind,
    /** A person or an agent; null for Most Wanted's own notices. */
    author: PrincipalRefSchema.nullable(),
    body: z.string(),
    at: At,
    /** The task a step-end line is about. */
    task: z.object({ id: z.string(), key: z.string(), title: z.string() }).nullable(),
    /** A step-end line's move; null for any other message. */
    step: StepEndSchema.nullable(),
    /** A person's message: the agents it named with "@" (empty: every agent was asked) and how many turns it began. */
    to: z.array(z.string()),
    asked: z.number().int().nullable(),
    /** The room conversation and turn a reply (or a wake-up's notice) belongs to. */
    chatId: z.string().nullable(),
    turnId: z.string().nullable(),
  })
  .openapi('RoomMessage');

export const RoomSchema = z
  .object({
    flow: z.object({ id: z.string(), name: z.string(), leadPrincipalId: z.string() }),
    /** Who is in the room: its agents (the Lead first, then each step's) and its people. */
    members: z.object({ agents: z.array(PrincipalRefSchema), people: z.array(PrincipalRefSchema) }),
    /** The caller writes here (the team's people, admins and owners); everyone else of the company reads. */
    mayWrite: z.boolean(),
    /** The page, oldest first. */
    messages: z.array(RoomMessageSchema),
    /** The cursor of the page before this one; null when this one reaches the start. */
    nextBefore: z.string().nullable(),
    /** The agents with a turn Most Wanted queued in their room conversation that waits or runs now. */
    replying: z.array(
      z.object({
        principalId: z.string(),
        status: z.enum(['queued', 'running']),
        machineWait: z.string().nullable(),
      }),
    ),
    /** The cap and the answers asked in the last hour. */
    cap: z.object({ maxPerHour: z.number().int(), askedLastHour: z.number().int() }),
  })
  .openapi('Room');

export type RoomQuery = z.infer<typeof RoomQuerySchema>;
export type RoomMessageView = z.infer<typeof RoomMessageSchema>;
export type RoomView = z.infer<typeof RoomSchema>;
