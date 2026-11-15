import { z } from '@hono/zod-openapi';
import { FlowStepKind, TaskPriority, TaskStepState } from '@mwc/shared/enums';
import { BOARD_DONE } from '@mwc/shared/flows';
import { At, PrincipalRefSchema } from '../schemas.ts';

/** `?done=<n>`: how many of the latest done tasks the Done column shows. */
export const BoardQuerySchema = z.object({
  done: z.coerce
    .number()
    .int()
    .min(0)
    .max(BOARD_DONE.max)
    .optional()
    .openapi({ param: { name: 'done', in: 'query' }, example: '10' }),
});

/** A task on the board. */
export const BoardCardSchema = z
  .object({
    id: z.string(),
    key: z.string().openapi({ example: 'T-12' }),
    title: z.string(),
    priority: TaskPriority,
    /** Whether the flow's Autotake may take it from Queued by itself (T-34). */
    autoTake: z.boolean(),
    /** Its entries into its step so far; null in Queued and Done. */
    round: z.number().int().min(1).nullable(),
    stepState: TaskStepState.nullable(),
    /** A card of the Done column that was cancelled rather than done. */
    cancelled: z.boolean(),
    /** Why it is blocked at its step (S5.3b); null unless `blocked`. */
    blockedReason: z.string().nullable(),
    /** Who has it: the step's assignee, the Lead for an escalated one; null in Queued and Done. */
    assignee: PrincipalRefSchema.nullable(),
    /** The step it is at, or escalated from. */
    stepId: z.string().nullable(),
    /** How many artifacts it has (S5.3b; skipped files left out). */
    artifacts: z.number().int().min(0),
    /** When its agent Lead was woken about it as it stands now (S6c); null when it was not, or it moved since. */
    leadNotifiedAt: At.nullable(),
    updatedAt: At,
  })
  .openapi('BoardCard');

/** A column: Queued, one per step in order, Done (the latest), Escalated. */
export const BoardColumnSchema = z
  .object({
    kind: z.enum(['queued', 'step', 'done', 'escalated']),
    title: z.string().openapi({ example: 'Code review' }),
    /** A step's column: the step, its kind and its assignee. */
    step: z.object({ id: z.string(), kind: FlowStepKind, assignee: PrincipalRefSchema }).nullable(),
    cards: z.array(BoardCardSchema),
    /** All the column's tasks: Done counts every closed (done or cancelled) task of the sprint, not only the cards shown. */
    total: z.number().int().min(0),
  })
  .openapi('BoardColumn');

export const BoardSchema = z
  .object({
    flow: z.object({
      id: z.string(),
      name: z.string(),
      lead: PrincipalRefSchema,
      /** Where a new task goes when its creator does not say (T-38): a step's id, or null for Queued. */
      newTaskStepId: z.string().nullable(),
      /** Whether a new task is Autotake when its creator does not say (T-38). */
      newTaskAutoTake: z.boolean(),
    }),
    /** The flow's current sprint (T-37): Done is its closed tasks; every open task is in it. */
    sprint: z.object({
      id: z.string(),
      number: z.number().int().min(1),
      name: z.string(),
      startedAt: At,
      startedBy: PrincipalRefSchema,
      done: z.number().int().min(0),
      cancelled: z.number().int().min(0),
    }),
    columns: z.array(BoardColumnSchema),
  })
  .openapi('Board');

export type BoardView = z.infer<typeof BoardSchema>;
export type BoardColumnView = z.infer<typeof BoardColumnSchema>;
export type BoardCardView = z.infer<typeof BoardCardSchema>;
