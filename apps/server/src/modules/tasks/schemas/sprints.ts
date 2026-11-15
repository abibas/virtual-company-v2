import { z } from '@hono/zod-openapi';
import { TaskPriority } from '@mwc/shared/enums';
import { At, FlowParamsSchema, PrincipalRefSchema } from '../schemas.ts';

// A flow's sprints (T-37): the list, one sprint with its report, and a new sprint.

export const SprintParamsSchema = FlowParamsSchema.extend({
  sprintId: z.string().openapi({ param: { name: 'sprintId', in: 'path' }, example: '019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f' }),
});

/** A sprint's name, as the `sprints_name_check` of the database allows it. */
const SPRINT_NAME = { min: 1, max: 80 } as const;

/** A new sprint: its name (default "Sprint 4 · Mon 16 Nov"). */
export const NewSprintSchema = z
  .object({ name: z.string().trim().min(SPRINT_NAME.min).max(SPRINT_NAME.max).optional() })
  .openapi('NewSprint');

/** A sprint in the list: when it started and ended and by whom, and its counts (so far, for the current one). */
export const SprintSummarySchema = z
  .object({
    id: z.string(),
    number: z.number().int().min(1),
    name: z.string().openapi({ example: 'Sprint 4 · Mon 16 Nov' }),
    /** The flow's current sprint (not ended). */
    current: z.boolean(),
    startedAt: At,
    startedBy: PrincipalRefSchema,
    endedAt: At.nullable(),
    endedBy: PrincipalRefSchema.nullable(),
    done: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    /** Carried over into the next sprint; for the current one, the open tasks it would carry over now. */
    carriedOver: z.number().int().min(0),
    /** Tasks made in the flow while it ran. */
    created: z.number().int().min(0),
  })
  .openapi('SprintSummary');

const ReportTaskSchema = z.object({
  key: z.string().openapi({ example: 'T-12' }),
  title: z.string(),
  priority: TaskPriority,
  closedAt: At,
});

/** A sprint's report: the snapshot written when it ended, or, for the current one, its report so far. */
export const SprintReportSchema = z
  .object({
    done: z.array(ReportTaskSchema),
    cancelled: z.array(ReportTaskSchema),
    carriedOver: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        where: z.string().openapi({ example: 'Develop' }),
      }),
    ),
    created: z.number().int().min(0),
  })
  .openapi('SprintReport');

export const SprintSchema = SprintSummarySchema.extend({ report: SprintReportSchema }).openapi('Sprint');

export const SprintListSchema = z.object({ sprints: z.array(SprintSummarySchema) }).openapi('SprintList');

export type NewSprint = z.infer<typeof NewSprintSchema>;
export type SprintSummaryView = z.infer<typeof SprintSummarySchema>;
export type SprintReportView = z.infer<typeof SprintReportSchema>;
export type SprintView = z.infer<typeof SprintSchema>;
