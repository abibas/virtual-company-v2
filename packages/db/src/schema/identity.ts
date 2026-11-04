import {
  IdentityEventStatus,
  IdentityInboxType,
  IdentityOutboxOp,
  IdentityOutboxStatus,
} from '@mwc/shared/enums';
import type { IdentityInboxEvent, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { companies } from './companies.ts';

/**
 * The identity bookkeeping (global tables): the inbox of provider events, the projector's ordering marks and
 * parked events (`@mwc/identity-core`'s `IdentityStore`), and the outbox of provider calls.
 */

/**
 * The webhook and SCIM inbox: one row per verified delivery, deduplicated on `(provider, external_event_id)`. A
 * delivery of a provider event type this product does not project is recorded as `ignored`, already processed.
 */
export const identityEvents = pgTable(
  'identity_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    provider: text('provider').notNull(),
    /** The provider's delivery id (Clerk: the svix id). */
    externalEventId: text('external_event_id').notNull(),
    type: text('type').$type<IdentityInboxType>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** The normalized event as the projector takes it, or the ignored delivery (its provider type). */
    payload: jsonb('payload').$type<IdentityInboxEvent>().notNull(),
    status: text('status').$type<IdentityEventStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /**
     * When the event is due for a try by the retry loop: the webhook inbox sets it a lease ahead when it records the
     * event (so a delivery whose inline try never finished is picked up), then the backoff after a failed try; null
     * once processed or given up.
     */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('identity_events_provider_external_event_id_unique').on(t.provider, t.externalEventId),
    check('identity_events_type_check', oneOf(t.type, IdentityInboxType.options)),
    check('identity_events_status_check', oneOf(t.status, IdentityEventStatus.options)),
    check('identity_events_attempts_check', sql`${t.attempts} >= 0`),
    index('identity_events_status_idx').on(t.status, t.nextAttemptAt),
  ],
);

/**
 * The projector's ordering marks, by `identityKeys` key: the provider `updatedAt` (ms) of the newest state
 * applied, and a sticky deletion flag.
 */
export const identityMarks = pgTable('identity_marks', {
  key: text('key').primaryKey(),
  providerUpdatedAtMs: bigint('provider_updated_at_ms', { mode: 'number' }),
  deleted: boolean('deleted').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Events parked until their user or company exists; `id` keeps them in parking order. */
export const identityParkedEvents = pgTable(
  'identity_parked_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    externalEventId: text('external_event_id').notNull(),
    event: jsonb('event').$type<NormalizedIdentityEvent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('identity_parked_events_key_event_unique').on(t.key, t.externalEventId)],
);

/**
 * Provider calls owed after a local change (local first: access changes here at once), retried until done.
 * `idempotency_key` makes enqueueing the same call twice impossible.
 */
export const identityOutbox = pgTable(
  'identity_outbox',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    op: text('op').$type<IdentityOutboxOp>().notNull(),
    /** The call's arguments (the invitation id, the role, ...). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').$type<IdentityOutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('identity_outbox_op_check', oneOf(t.op, IdentityOutboxOp.options)),
    check('identity_outbox_status_check', oneOf(t.status, IdentityOutboxStatus.options)),
    check('identity_outbox_attempts_check', sql`${t.attempts} >= 0`),
    index('identity_outbox_due_idx').on(t.status, t.nextAttemptAt),
  ],
);

export type IdentityEventRow = typeof identityEvents.$inferSelect;
export type NewIdentityEventRow = typeof identityEvents.$inferInsert;
export type IdentityMarkRow = typeof identityMarks.$inferSelect;
export type IdentityParkedEventRow = typeof identityParkedEvents.$inferSelect;
export type IdentityOutboxRow = typeof identityOutbox.$inferSelect;
export type NewIdentityOutboxRow = typeof identityOutbox.$inferInsert;
