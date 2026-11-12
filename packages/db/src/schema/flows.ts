import { FlowStepKind, StepOnReturn, StepStarts } from '@mwc/shared/enums';
import { FLOW_NAME, LEAD_WAKE, LEAD_WAKE_DEFAULTS, SEND_BACK_LIMIT, STEP_NAME } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/** A number written into a CHECK as it is (the limits come from `@mwc/shared/flows`, which the API's schemas read too). */
const n = (value: number) => sql.raw(String(value));

/** `<value> between <min> and <max>`. */
const within = (value: SQL | AnyPgColumn, range: { readonly min: number; readonly max: number }) =>
  sql`${value} between ${n(range.min)} and ${n(range.max)}`;

/**
 * A team's flow (S5.3a, docs/processes.md): its Lead, the manager on the chart whose team it is (a person or an agent;
 * one flow per Lead for now), and its name. Its steps are `flow_steps`, its tasks `tasks`. Since S6c an agent Lead wakes
 * up by itself in its team chat (`lead_wake_events`): which events wake it, the quiet window that coalesces them, and
 * the caps on wake-ups per hour and per day (`wake_*`, defaults `LEAD_WAKE_DEFAULTS`), and since its check-ins the
 * minutes between two while the flow has work (`wake_check_in_minutes`, 5 by default; null: none).
 */
export const flows = pgTable(
  'flows',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    leadPrincipalId: uuid('lead_principal_id').notNull(),
    name: text('name').notNull(),
    /** Wake the Lead agent when a task is escalated to it (S6c). */
    wakeEscalated: boolean('wake_escalated').notNull().default(LEAD_WAKE_DEFAULTS.escalated),
    /** ... when a task is blocked at its step. */
    wakeBlocked: boolean('wake_blocked').notNull().default(LEAD_WAKE_DEFAULTS.blocked),
    /** ... when a step's turn ended without a hand-off. */
    wakeTurnEnded: boolean('wake_turn_ended').notNull().default(LEAD_WAKE_DEFAULTS.turnEnded),
    /** ... when a task is done (a digest). */
    wakeDone: boolean('wake_done').notNull().default(LEAD_WAKE_DEFAULTS.done),
    /** ... when a task has waited this many hours for a person's sign-off; null: never. */
    wakeSignoffHours: integer('wake_signoff_hours'),
    /** Events within this many seconds of the first go as one wake-up. */
    wakeWindowSeconds: integer('wake_window_seconds').notNull().default(LEAD_WAKE.windowSeconds.default),
    /** At most this many wake-ups an hour, and a day; past either, the Lead's nearest person is told instead. */
    wakeMaxPerHour: integer('wake_max_per_hour').notNull().default(LEAD_WAKE.perHour.default),
    wakeMaxPerDay: integer('wake_max_per_day').notNull().default(LEAD_WAKE.perDay.default),
    /** Check in with the Lead agent every this many minutes while the flow has work; null: never. */
    wakeCheckInMinutes: integer('wake_check_in_minutes').default(LEAD_WAKE.checkInMinutes.default),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('flows', t),
    unique('flows_lead_unique').on(t.companyId, t.leadPrincipalId),
    tenantForeignKey('flows_lead_fk', t.companyId, t.leadPrincipalId, principals),
    tenantForeignKey('flows_created_by_fk', t.companyId, t.createdBy, principals),
    check('flows_name_check', within(sql`char_length(${t.name})`, FLOW_NAME)),
    check(
      'flows_wake_signoff_hours_check',
      sql`${t.wakeSignoffHours} is null or ${within(t.wakeSignoffHours, LEAD_WAKE.signoffHours)}`,
    ),
    check('flows_wake_window_check', within(t.wakeWindowSeconds, LEAD_WAKE.windowSeconds)),
    check('flows_wake_per_hour_check', within(t.wakeMaxPerHour, LEAD_WAKE.perHour)),
    check('flows_wake_per_day_check', within(t.wakeMaxPerDay, LEAD_WAKE.perDay)),
    check(
      'flows_wake_check_in_check',
      sql`${t.wakeCheckInMinutes} is null or ${within(t.wakeCheckInMinutes, LEAD_WAKE.checkInMinutes)}`,
    ),
  ],
);

/** The steps' key, for a step's send-back target (a function with its type said: the table points at itself). */
const stepKey = (): { readonly companyId: AnyPgColumn; readonly id: AnyPgColumn } => flowSteps;

/**
 * A flow's steps in order (`position`, from 1, unique in the flow): a name, a kind, the person or agent assigned,
 * whether a task starts there by itself, Keep or Fresh when the same task comes back, and for Check and Sign-off steps
 * an earlier step to send a task back to and how many send-backs go before the Lead gets it (null: no limit). The
 * service keeps names unique per flow whatever the case, targets earlier in the same flow, and removes a step only
 * when no task is at it or bound for it (`tasks` points here); a step keeps its id when the list is reordered.
 */
export const flowSteps = pgTable(
  'flow_steps',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    flowId: uuid('flow_id').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<FlowStepKind>().notNull(),
    assigneePrincipalId: uuid('assignee_principal_id').notNull(),
    starts: text('starts').$type<StepStarts>().notNull().default('manual'),
    onReturn: text('on_return').$type<StepOnReturn>().notNull().default('keep'),
    sendsBackToStepId: uuid('sends_back_to_step_id'),
    sendBackLimit: integer('send_back_limit'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('flow_steps', t),
    unique('flow_steps_position_unique').on(t.companyId, t.flowId, t.position),
    tenantForeignKey('flow_steps_flow_fk', t.companyId, t.flowId, flows),
    tenantForeignKey('flow_steps_assignee_fk', t.companyId, t.assigneePrincipalId, principals),
    tenantForeignKey('flow_steps_sends_back_to_fk', t.companyId, t.sendsBackToStepId, stepKey()),
    check('flow_steps_kind_check', oneOf(t.kind, FlowStepKind.options)),
    check('flow_steps_starts_check', oneOf(t.starts, StepStarts.options)),
    check('flow_steps_on_return_check', oneOf(t.onReturn, StepOnReturn.options)),
    check('flow_steps_position_check', sql`${t.position} >= 1`),
    check('flow_steps_name_check', within(sql`char_length(${t.name})`, STEP_NAME)),
    check(
      'flow_steps_send_back_check',
      sql`${t.sendsBackToStepId} is null or (${t.kind} <> 'work' and ${t.sendsBackToStepId} <> ${t.id})`,
    ),
    check(
      'flow_steps_limit_check',
      sql`${t.sendBackLimit} is null or (${t.kind} <> 'work' and ${within(t.sendBackLimit, SEND_BACK_LIMIT)})`,
    ),
    index('flow_steps_assignee_idx').on(t.companyId, t.assigneePrincipalId),
  ],
);

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;
export type FlowStep = typeof flowSteps.$inferSelect;
export type NewFlowStep = typeof flowSteps.$inferInsert;
