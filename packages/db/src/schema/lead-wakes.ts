import { LeadWakeKind, LeadWakeOutcome } from '@mwc/shared/enums';
import { LEAD_WAKE_REASON_MAX, STEP_NAME } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chats } from './chats.ts';
import { createdAt, oneOf } from './columns.ts';
import { flows } from './flows.ts';
import { tasks } from './tasks.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * What wakes a flow's Lead agent (S6c, docs/processes.md "Built: the Lead wakes up"): one row per event (a task
 * escalated, blocked, a turn ended without a hand-off, done, a sign-off waiting), written in the transaction that made
 * it when the flow's Lead is an agent and the flow's settings say so. It is `pending` until the server's wake-up tick
 * first sees it (`seen_at`, its clock) and the flow's quiet window after the oldest seen passes; then the flow's pending
 * events go together as one turn in the Lead's team chat (`woke`, with the chat and the turn), are held by a cap
 * (`capped`) or by a Lead that cannot run (`unreachable`, with why in `detail`), or are let go (`dropped`: the task moved
 * on first). `turn_id` is a plain id: a person may discard the waiting turn.
 */
export const leadWakeEvents = pgTable(
  'lead_wake_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    flowId: uuid('flow_id').notNull(),
    taskId: uuid('task_id').notNull(),
    kind: text('kind').$type<LeadWakeKind>().notNull(),
    /** The step it happened at, as it was called then; null for none (a done task). */
    stepName: text('step_name'),
    /** Why (a send-back's, a block's), clipped. */
    reason: text('reason'),
    outcome: text('outcome').$type<LeadWakeOutcome>().notNull().default('pending'),
    /** When the wake-up tick first saw it, by the server's clock: the flow's quiet window starts at its oldest. */
    seenAt: at('seen_at'),
    /** When it was told, held or let go (the tick's clock); null while pending. */
    deliveredAt: at('delivered_at'),
    /** The team chat and the turn that told it (`woke`). */
    chatId: uuid('chat_id'),
    turnId: uuid('turn_id'),
    /** Why it was not told: the refusal's words (`unreachable`), the cap (`capped`), the move (`dropped`). */
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('lead_wake_events', t),
    tenantForeignKey('lead_wake_events_flow_fk', t.companyId, t.flowId, flows),
    tenantForeignKey('lead_wake_events_task_fk', t.companyId, t.taskId, tasks),
    tenantForeignKey('lead_wake_events_chat_fk', t.companyId, t.chatId, chats),
    check('lead_wake_events_kind_check', oneOf(t.kind, LeadWakeKind.options)),
    check('lead_wake_events_outcome_check', oneOf(t.outcome, LeadWakeOutcome.options)),
    check(
      'lead_wake_events_step_name_check',
      sql`char_length(${t.stepName}) between ${n(STEP_NAME.min)} and ${n(STEP_NAME.max)}`,
    ),
    check('lead_wake_events_reason_check', sql`char_length(${t.reason}) <= ${n(LEAD_WAKE_REASON_MAX)}`),
    check('lead_wake_events_detail_check', sql`char_length(${t.detail}) between 1 and 2000`),
    check('lead_wake_events_delivered_check', sql`(${t.outcome} = 'pending') = (${t.deliveredAt} is null)`),
    check(
      'lead_wake_events_woke_check',
      sql`(${t.outcome} = 'woke') = (${t.turnId} is not null) and (${t.turnId} is null) = (${t.chatId} is null)`,
    ),
    index('lead_wake_events_pending_idx').on(t.seenAt).where(sql`${t.outcome} = 'pending'`),
    index('lead_wake_events_flow_idx').on(t.companyId, t.flowId, t.deliveredAt),
    index('lead_wake_events_task_idx').on(t.companyId, t.taskId, t.id),
  ],
);

export type LeadWakeEvent = typeof leadWakeEvents.$inferSelect;
export type NewLeadWakeEvent = typeof leadWakeEvents.$inferInsert;
