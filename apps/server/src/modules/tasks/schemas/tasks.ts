import { z } from '@hono/zod-openapi';
import {
  ChatTurnStatus,
  TaskAction,
  TaskEventKind,
  TaskPriority,
  TaskState,
  TaskStepState,
} from '@mwc/shared/enums';
import { TASK_DESCRIPTION_MAX, TASK_PAGE, TASK_REASON_MAX, TASK_TITLE } from '@mwc/shared/flows';
import { CURSOR_PATTERN, STATES_PATTERN } from '../rules/list.ts';
import { At, PrincipalRefSchema, StepRefSchema } from '../schemas.ts';

const Title = z.string().trim().min(TASK_TITLE.min).max(TASK_TITLE.max).openapi({ example: 'Fix the login' });
const Description = z.string().max(TASK_DESCRIPTION_MAX).openapi({ description: 'Markdown' });
const query = (name: string, example: string) => ({ param: { name, in: 'query' as const }, example });

/**
 * `?flowId&state&stepId&assignee&q&sort&limit&before&cursor`: the company's tasks, newest first (or the latest activity
 * first), a page at a time.
 */
export const TaskListQuerySchema = z.object({
  flowId: z.uuid().optional().openapi(query('flowId', '019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f')),
  /** One state, or several with commas between them (`queued,active,escalated`). */
  state: z
    .string()
    .regex(STATES_PATTERN, 'a task state, or several with commas between them')
    .optional()
    .openapi(query('state', 'queued,active,escalated')),
  /** A task's key (`T-12`) or number, or a part of its title (any case). */
  q: z.string().max(TASK_TITLE.max).optional().openapi(query('q', 'login')),
  /** `created` (the default): the newest task first; `updated`: the latest change first. */
  sort: z.enum(['created', 'updated']).optional().openapi(query('sort', 'updated')),
  stepId: z.uuid().optional().openapi(query('stepId', '019a4f0c-b2c3-7d4e-8f50-6a7b8c9d0e1f')),
  /** Tasks at a step of this principal's, and escalated tasks of the flows it leads. */
  assignee: z.uuid().optional().openapi(query('assignee', '019a4f0c-9d2f-7a3b-8c41-5e2f3a7b8c90')),
  limit: z.coerce.number().int().min(1).max(TASK_PAGE.max).optional().openapi(query('limit', '50')),
  /** The `nextBefore` of the page before. */
  before: z.coerce.number().int().min(1).optional().openapi(query('before', '12')),
  /** The `nextCursor` of the page before, in either order. */
  cursor: z
    .string()
    .regex(CURSOR_PATTERN, 'the nextCursor of a page')
    .optional()
    .openapi(query('cursor', '1762941600000.12')),
});

export const CreateTaskSchema = z
  .object({
    flowId: z.uuid(),
    title: Title,
    description: Description.optional(),
    priority: TaskPriority.optional(),
    /** Straight into this step of the flow (the Lead's people and admins); queued without it. */
    stepId: z.uuid().optional(),
  })
  .openapi('CreateTask');

export const EditTaskSchema = z
  .object({ title: Title.optional(), description: Description.optional(), priority: TaskPriority.optional() })
  .openapi('EditTask');

export const TaskActionSchema = z
  .object({
    action: TaskAction,
    /** `route`: the step the task goes to. */
    toStepId: z.uuid().optional(),
    /** Why: a send-back's findings (required), a cancel's or a route's reason. */
    reason: z.string().max(TASK_REASON_MAX).optional(),
    /** The step the caller saw the task at; a task that moved since is refused (409 `task_moved`). */
    fromStepId: z.uuid().nullable().optional(),
    /**
     * Move it even while its step's turn runs (S5.3b): the turn is stopped first. Without it such a move is refused
     * (409 `step_running`).
     */
    force: z.boolean().optional(),
  })
  .openapi('TaskActionRequest');

/** A task as lists show it. */
export const TaskSummarySchema = z
  .object({
    id: z.string(),
    key: z.string().openapi({ example: 'T-12' }),
    number: z.number().int().min(1),
    flowId: z.string(),
    title: z.string(),
    priority: TaskPriority,
    state: TaskState,
    /** The step it is at (active) or escalated from; null when queued or closed. */
    step: StepRefSchema.nullable(),
    stepState: TaskStepState.nullable(),
    /** Why it is blocked at its step (S5.3b: its turn could not start, or failed); null unless `blocked`. */
    blockedReason: z.string().nullable(),
    /** Its entries into its step so far (1 the first time); null when it is at no step. */
    round: z.number().int().min(1).nullable(),
    /** Who has it: the step's assignee, or the Lead for an escalated task; null when queued or closed. */
    assignee: PrincipalRefSchema.nullable(),
    createdBy: PrincipalRefSchema,
    createdAt: At,
    updatedAt: At,
    closedAt: At.nullable(),
  })
  .openapi('TaskSummary');

export const TaskListSchema = z
  .object({
    tasks: z.array(TaskSummarySchema),
    /** The `before` of the next page (newest first); null on the last one. */
    nextBefore: z.number().int().nullable(),
    /** The `cursor` of the next page, in the order asked for; null on the last one. */
    nextCursor: z.string().nullable(),
  })
  .openapi('TaskList');

/** One move in a task's history. */
export const TaskEventSchema = z
  .object({
    id: z.string(),
    kind: TaskEventKind,
    /** Who did it; null when it happened by itself (a step that starts on entry). */
    actor: PrincipalRefSchema.nullable(),
    from: z.object({ id: z.string(), name: z.string() }).nullable(),
    to: z.object({ id: z.string(), name: z.string() }).nullable(),
    round: z.number().int().nullable(),
    reason: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
    at: At,
  })
  .openapi('TaskEvent');

/** A step's conversation of the task (S5.3b): a chat (`GET …/chats/{chatId}`, its stream, its terminal). */
export const TaskConversationSchema = z
  .object({
    chatId: z.string(),
    /** The step, by its name now (a step removed since: `a removed step`). */
    step: z.object({ id: z.string(), name: z.string() }),
    /** The round of the step it began in. */
    round: z.number().int().min(1),
    agent: PrincipalRefSchema.nullable(),
    title: z.string().nullable(),
    /** Whether it has a harness conversation to resume yet. */
    started: z.boolean(),
    /**
     * Where its turns stand: the running turn's status while one runs, else its latest turn's (`queued`, `done`,
     * `failed`, `stopped`), and its last activity (the latest start or end of a turn); null before its first turn.
     */
    lastTurn: z
      .object({
        status: ChatTurnStatus,
        at: At,
        waitsForMachine: z.boolean().openapi({
          description: "A `queued` turn that waits for the agent's stopped machine to start",
        }),
      })
      .nullable(),
    createdAt: At,
  })
  .openapi('TaskConversation');

/** The decision a step's agent recorded with its tools in the turn that runs (S6a), applied when the turn ends. */
export const TaskDecisionSchema = z
  .object({
    action: z.enum(['hand_on', 'pass', 'approve', 'send_back', 'blocked']),
    /** What it makes when the turn ends, as found when it was recorded. */
    outcome: z.enum(['moved', 'done', 'escalated', 'blocked']),
    /** The step it goes to (an escalation: where the stopped send-back was going); null for none. */
    to: z.object({ id: z.string(), name: z.string() }).nullable(),
    /** A send-back's or a block's reason. */
    reason: z.string().nullable(),
    by: PrincipalRefSchema,
    at: At,
  })
  .openapi('TaskDecision');

export const TaskDetailSchema = TaskSummarySchema.extend({
  description: z.string(),
  flow: z.object({ id: z.string(), name: z.string(), lead: PrincipalRefSchema }),
  /** Each step's entries and send-backs so far, in the flow's order (steps it never entered left out). */
  rounds: z.array(z.object({ step: StepRefSchema, entries: z.number().int(), sendBacks: z.number().int() })),
  /** Why it went to the Lead, and the step a retry sends it to. */
  escalation: z.object({ reason: z.string(), retryTo: StepRefSchema.nullable() }).nullable(),
  history: z.array(TaskEventSchema),
  /** The moves the caller may make now. */
  actions: z.array(TaskAction),
  /** Its steps' conversations (S5.3b), oldest first: each a chat of the step's agent, opened by its id. */
  conversations: z.array(TaskConversationSchema),
  /** How many artifacts it has (skipped files left out); `GET …/tasks/{taskId}/artifacts` lists them. */
  artifacts: z.number().int().min(0),
  /** The decision recorded in its step's running turn (S6a); null for none. */
  decision: TaskDecisionSchema.nullable(),
}).openapi('TaskDetail');

export const TaskMovedSchema = z
  .object({
    outcome: z.enum(['started', 'moved', 'done', 'escalated', 'cancelled']),
    task: TaskDetailSchema,
  })
  .openapi('TaskMoved');

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type EditTask = z.infer<typeof EditTaskSchema>;
export type TaskActionRequest = z.infer<typeof TaskActionSchema>;
export type TaskSummaryView = z.infer<typeof TaskSummarySchema>;
export type TaskDetailView = z.infer<typeof TaskDetailSchema>;
export type TaskEventView = z.infer<typeof TaskEventSchema>;
export type TaskConversationView = z.infer<typeof TaskConversationSchema>;
export type TaskDecisionView = z.infer<typeof TaskDecisionSchema>;
