import { TaskEventKind, TaskPriority, TaskState, TaskStepState } from '@mwc/shared/enums';
import { TASK_DESCRIPTION_MAX, TASK_REASON_MAX, TASK_TITLE, type TaskDecision } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { flowSteps, flows } from './flows.ts';
import { principals } from './principals.ts';
import { sprints } from './sprints.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/** How often a task entered a step and how often that step sent it back, by step id. */
export type TaskRounds = Record<string, { readonly entries: number; readonly sendBacks: number }>;

/**
 * One piece of work going through a flow (S5.3a, docs/processes.md): its company-wide number (`T-12`), title,
 * description (markdown) and priority; its state (`queued`, `active` at a step, `escalated` to the Lead, `done`,
 * `cancelled`); the step it is at (an active task) or escalated from, with its state there; the rounds of each step
 * (`rounds`: entries and send-backs by step id; a removed step's count stays, unused); why it was escalated and the
 * step a retry sends it to; why it is blocked at its step (S5.3b); the decision its step's agent recorded in the turn
 * that runs (S6a); who created it, and when it closed. The CHECKs keep the state and its columns in step.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    number: integer('number').notNull(),
    flowId: uuid('flow_id').notNull(),
    /**
     * The flow's sprint it belongs to (T-37): the current one while open; a closed task stays in the one it closed in.
     * Left out on insert, the trigger `tasks_join_current_sprint` puts it in its flow's current sprint.
     */
    sprintId: uuid('sprint_id')
      .notNull()
      .$defaultFn(() => sql`null`),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: text('priority').$type<TaskPriority>().notNull().default('normal'),
    /** Whether the flow's Autotake may take it from Queued by itself (T-34); off ("Manual") waits for a person. */
    autoTake: boolean('auto_take').notNull().default(false),
    /**
     * Its place in its flow's queue (T-39): Queued and Autotake go by priority, then this. Left out on insert, the
     * trigger `tasks_queue_at_end` puts it after every task of its flow (the end of its priority).
     */
    queuePosition: integer('queue_position')
      .notNull()
      .$defaultFn(() => sql`null`),
    state: text('state').$type<TaskState>().notNull().default('queued'),
    currentStepId: uuid('current_step_id'),
    stepState: text('step_state').$type<TaskStepState>(),
    rounds: jsonb('rounds').$type<TaskRounds>().notNull().default({}),
    escalationReason: text('escalation_reason'),
    escalationTargetStepId: uuid('escalation_target_step_id'),
    /** Why the task is blocked at its step (S5.3b: its turn could not start, or failed); only while `blocked`. */
    blockedReason: text('blocked_reason'),
    /**
     * The decision the step's agent recorded with its tools during its running turn (S6a: a move or a block), applied
     * when the turn ends; only while `active` (or, closed, a `reopen` from the conversation it closed in, T-28), and
     * gone with any move.
     */
    decision: jsonb('decision').$type<TaskDecision>(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    tenantKey('tasks', t),
    unique('tasks_number_unique').on(t.companyId, t.number),
    tenantForeignKey('tasks_flow_fk', t.companyId, t.flowId, flows),
    tenantForeignKey('tasks_sprint_fk', t.companyId, t.sprintId, sprints),
    tenantForeignKey('tasks_current_step_fk', t.companyId, t.currentStepId, flowSteps),
    tenantForeignKey('tasks_escalation_target_fk', t.companyId, t.escalationTargetStepId, flowSteps),
    tenantForeignKey('tasks_created_by_fk', t.companyId, t.createdBy, principals),
    check('tasks_number_check', sql`${t.number} >= 1`),
    check(
      'tasks_title_check',
      sql`char_length(${t.title}) between ${n(TASK_TITLE.min)} and ${n(TASK_TITLE.max)}`,
    ),
    check('tasks_description_check', sql`char_length(${t.description}) <= ${n(TASK_DESCRIPTION_MAX)}`),
    check('tasks_priority_check', oneOf(t.priority, TaskPriority.options)),
    check('tasks_state_check', oneOf(t.state, TaskState.options)),
    check('tasks_step_state_check', oneOf(t.stepState, TaskStepState.options)),
    check('tasks_rounds_check', sql`jsonb_typeof(${t.rounds}) = 'object'`),
    check(
      'tasks_step_check',
      sql`(${t.state} in ('active', 'escalated')) = (${t.currentStepId} is not null)`,
    ),
    check('tasks_step_state_presence_check', sql`(${t.state} = 'active') = (${t.stepState} is not null)`),
    check(
      'tasks_escalation_check',
      sql`(${t.state} = 'escalated') = (${t.escalationReason} is not null) and (${t.escalationTargetStepId} is null or ${t.state} = 'escalated')`,
    ),
    check(
      'tasks_escalation_reason_check',
      sql`char_length(${t.escalationReason}) between 1 and ${n(TASK_REASON_MAX)}`,
    ),
    check('tasks_closed_check', sql`(${t.state} in ('done', 'cancelled')) = (${t.closedAt} is not null)`),
    check(
      'tasks_blocked_reason_check',
      sql`${t.blockedReason} is null or (${t.stepState} = 'blocked' and char_length(${t.blockedReason}) between 1 and ${n(TASK_REASON_MAX)})`,
    ),
    // A decision is an active task's step turn's; a closed task holds one only to be reopened by it (T-28).
    check(
      'tasks_decision_check',
      sql`${t.decision} is null or (jsonb_typeof(${t.decision}) = 'object' and (${t.state} = 'active' or (${t.state} in ('done', 'cancelled') and ${t.decision} ->> 'action' = 'reopen')))`,
    ),
    index('tasks_flow_state_idx').on(t.companyId, t.flowId, t.state),
    index('tasks_flow_queue_idx').on(t.companyId, t.flowId, t.queuePosition),
    index('tasks_sprint_state_idx').on(t.companyId, t.sprintId, t.state),
    index('tasks_current_step_idx').on(t.companyId, t.currentStepId),
    index('tasks_escalation_target_idx').on(t.companyId, t.escalationTargetStepId),
  ],
);

/**
 * A task's history, oldest first (uuid v7 ids): what happened (`kind`), who did it (null: by itself, such as a step that
 * starts on entry), the steps it moved from and to with their names as they were (plain ids: a step removed later
 * leaves its history readable), the round it entered with, the reason given (a send-back's findings, a cancel's why)
 * and the details of the move (`{code, limit}` of an escalation, the fields of an edit).
 */
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    taskId: uuid('task_id').notNull(),
    kind: text('kind').$type<TaskEventKind>().notNull(),
    actorPrincipalId: uuid('actor_principal_id'),
    fromStepId: uuid('from_step_id'),
    fromStepName: text('from_step_name'),
    toStepId: uuid('to_step_id'),
    toStepName: text('to_step_name'),
    round: integer('round'),
    reason: text('reason'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('task_events', t),
    tenantForeignKey('task_events_task_fk', t.companyId, t.taskId, tasks),
    tenantForeignKey('task_events_actor_fk', t.companyId, t.actorPrincipalId, principals),
    check('task_events_kind_check', oneOf(t.kind, TaskEventKind.options)),
    check('task_events_round_check', sql`${t.round} >= 1`),
    check('task_events_reason_check', sql`char_length(${t.reason}) between 1 and ${n(TASK_REASON_MAX)}`),
    check('task_events_details_check', sql`jsonb_typeof(${t.details}) = 'object'`),
    index('task_events_task_idx').on(t.companyId, t.taskId, t.id),
  ],
);

/**
 * "Waits for" (T-39): a task that needs another of its flow (its code, or the same files or schema). Autotake skips it
 * while any task it waits for is not done or cancelled; a person or the Lead can still start it. The service keeps both
 * in one flow and refuses a cycle (422).
 */
export const taskWaits = pgTable(
  'task_waits',
  {
    companyId: companyIdColumn(),
    taskId: uuid('task_id').notNull(),
    waitsForTaskId: uuid('waits_for_task_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_waits_pk', columns: [t.companyId, t.taskId, t.waitsForTaskId] }),
    tenantForeignKey('task_waits_task_fk', t.companyId, t.taskId, tasks),
    tenantForeignKey('task_waits_waits_for_fk', t.companyId, t.waitsForTaskId, tasks),
    check('task_waits_not_itself_check', sql`${t.taskId} <> ${t.waitsForTaskId}`),
    index('task_waits_waits_for_idx').on(t.companyId, t.waitsForTaskId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type TaskWait = typeof taskWaits.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
