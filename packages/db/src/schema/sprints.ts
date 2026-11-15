import type { TaskPriority } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './columns.ts';
import { flows } from './flows.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/** A sprint's name: "Sprint 4 · Mon 16 Nov" by default, or what whoever started it typed (the API's schema says 80 too). */
const SPRINT_NAME = { min: 1, max: 80 } as const;

/** A closed task as a sprint's report keeps it. */
export interface SprintReportTask {
  readonly key: string;
  readonly title: string;
  readonly priority: TaskPriority;
  readonly closedAt: string;
}

/** An open task carried over into the next sprint, and where it was (Queued, a step, escalated from a step). */
export interface SprintCarriedTask {
  readonly key: string;
  readonly title: string;
  readonly where: string;
}

/** What a sprint did, written when it ends (T-37): its done and cancelled tasks, those carried over, how many were made. */
export interface SprintReport {
  readonly done: readonly SprintReportTask[];
  readonly cancelled: readonly SprintReportTask[];
  readonly carriedOver: readonly SprintCarriedTask[];
  readonly created: number;
}

/**
 * A flow's iteration (T-37): numbered 1, 2, 3… per flow, named, started by someone at a time and ended by someone
 * (`ended_at` null while it is the current one; a flow always has exactly one current sprint). Every task belongs to
 * one (`tasks.sprint_id`): a new task joins the current sprint (a task inserted without one gets it from the trigger
 * `tasks_join_current_sprint`, which makes the flow's Sprint 1 when it has none yet), and a new sprint takes every open
 * task along while the closed ones stay. Its `report` is the snapshot written when it ends.
 */
export const sprints = pgTable(
  'sprints',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    flowId: uuid('flow_id').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    startedBy: uuid('started_by').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by'),
    report: jsonb('report').$type<SprintReport>(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('sprints', t),
    unique('sprints_number_unique').on(t.companyId, t.flowId, t.number),
    tenantForeignKey('sprints_flow_fk', t.companyId, t.flowId, flows),
    tenantForeignKey('sprints_started_by_fk', t.companyId, t.startedBy, principals),
    tenantForeignKey('sprints_ended_by_fk', t.companyId, t.endedBy, principals),
    uniqueIndex('sprints_one_current_idx').on(t.flowId).where(sql`${t.endedAt} is null`),
    check('sprints_number_check', sql`${t.number} >= 1`),
    check(
      'sprints_name_check',
      sql`char_length(${t.name}) between ${sql.raw(String(SPRINT_NAME.min))} and ${sql.raw(String(SPRINT_NAME.max))}`,
    ),
    check('sprints_ended_check', sql`${t.endedBy} is null or ${t.endedAt} is not null`),
    check(
      'sprints_report_check',
      sql`${t.report} is null or (${t.endedAt} is not null and jsonb_typeof(${t.report}) = 'object')`,
    ),
  ],
);

export type Sprint = typeof sprints.$inferSelect;
export type NewSprint = typeof sprints.$inferInsert;
