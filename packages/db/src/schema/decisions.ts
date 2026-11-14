import { DecisionOutcome } from '@mwc/shared/enums';
import { DECISION_LIMITS } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { chats, chatTurns } from './chats.ts';
import { createdAt, oneOf } from './columns.ts';
import { agents } from './org.ts';
import { tasks } from './tasks.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/**
 * The decision log (2026-11-14, docs/processes.md "Decisions"): each real decision an agent recorded with its
 * `record_decision` tool during a turn: what it decided (one line), why, the sources it relied on (a jsonb list of
 * links and references), and the outcome when it said one; with the agent, its chat and turn, the task whose step the
 * turn belonged to, and the contact the conversation is with. `contact_id` is a plain id with no foreign key until the
 * contacts land (a Slack chat's contact); null until then. `event_seq` is the turn's last event stored when the
 * decision was recorded, where the thread shows it. Written with the app's clock, never changed.
 */
export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    agentId: uuid('agent_id').notNull(),
    chatId: uuid('chat_id').notNull(),
    turnId: uuid('turn_id').notNull(),
    /** The task whose step the turn belonged to; null for any other turn. */
    taskId: uuid('task_id'),
    /** The contact the turn's conversation is with; no foreign key yet (the contacts table comes later). */
    contactId: uuid('contact_id'),
    what: text('what').notNull(),
    why: text('why').notNull(),
    /** The links and references it relied on, as given: a JSON array of strings. */
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    outcome: text('outcome').$type<DecisionOutcome>(),
    /** The turn's last event stored when it was recorded (0: none yet); null when not known. */
    eventSeq: integer('event_seq'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('decisions', t),
    tenantForeignKey('decisions_agent_fk', t.companyId, t.agentId, agents),
    tenantForeignKey('decisions_chat_fk', t.companyId, t.chatId, chats),
    tenantForeignKey('decisions_turn_fk', t.companyId, t.turnId, chatTurns),
    tenantForeignKey('decisions_task_fk', t.companyId, t.taskId, tasks),
    check('decisions_what_check', sql`char_length(${t.what}) between 1 and ${n(DECISION_LIMITS.what)}`),
    check('decisions_why_check', sql`char_length(${t.why}) between 1 and ${n(DECISION_LIMITS.why)}`),
    check(
      'decisions_sources_check',
      sql`jsonb_typeof(${t.sources}) = 'array' and jsonb_array_length(${t.sources}) <= ${n(DECISION_LIMITS.sources)}`,
    ),
    check('decisions_outcome_check', oneOf(t.outcome, DecisionOutcome.options)),
    check('decisions_event_seq_check', sql`${t.eventSeq} is null or ${t.eventSeq} >= 0`),
    index('decisions_agent_idx').on(t.companyId, t.agentId, t.createdAt),
    index('decisions_chat_idx').on(t.companyId, t.chatId, t.createdAt),
    index('decisions_task_idx').on(t.companyId, t.taskId, t.createdAt),
    index('decisions_contact_idx').on(t.companyId, t.contactId, t.createdAt),
  ],
);

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
