import { FlowStepKind, StepOnReturn, StepStarts } from '@mwc/shared/enums';
import { FLOW_NAME, SEND_BACK_LIMIT, STEP_NAME } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
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
 * one flow per Lead for now), and its name. Its steps are `flow_steps`, its tasks `tasks`.
 */
export const flows = pgTable(
  'flows',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    leadPrincipalId: uuid('lead_principal_id').notNull(),
    name: text('name').notNull(),
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
