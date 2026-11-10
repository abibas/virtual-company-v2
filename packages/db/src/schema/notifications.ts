import { NotificationEmailStatus, NotificationKind } from '@mwc/shared/enums';
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
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/**
 * What changed for a person in a company (S2.9, docs/notifications.md): who gets it (a person's principal; agents get
 * none), what kind of change, its details by principal id (`payload`, names are read when it is shown), who made it
 * (null: the system, such as the identity provider), when it was read in the app, and its email: pending until the
 * jobs loop sends it with the person's other changes of the same minute, then sent, failed or skipped.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    recipientPrincipalId: uuid('recipient_principal_id').notNull(),
    kind: text('kind').$type<NotificationKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    actorPrincipalId: uuid('actor_principal_id'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailStatus: text('email_status').$type<NotificationEmailStatus>().notNull().default('pending'),
    /** When the jobs loop first saw it (its clock): a batch waits a quiet minute from its newest. */
    emailQueuedAt: timestamp('email_queued_at', { withTimezone: true }),
    /** After a failed try, not before this. */
    emailNextAt: timestamp('email_next_at', { withTimezone: true }),
    emailAttempts: integer('email_attempts').notNull().default(0),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    /** Why it failed or was skipped. */
    emailError: text('email_error'),
  },
  (t) => [
    tenantKey('notifications', t),
    tenantForeignKey('notifications_recipient_fk', t.companyId, t.recipientPrincipalId, principals),
    tenantForeignKey('notifications_actor_fk', t.companyId, t.actorPrincipalId, principals),
    check('notifications_kind_check', oneOf(t.kind, NotificationKind.options)),
    check('notifications_email_status_check', oneOf(t.emailStatus, NotificationEmailStatus.options)),
    check('notifications_payload_check', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check('notifications_email_attempts_check', sql`${t.emailAttempts} >= 0`),
    index('notifications_recipient_idx').on(t.companyId, t.recipientPrincipalId, t.id),
    index('notifications_unread_idx').on(t.companyId, t.recipientPrincipalId).where(sql`${t.readAt} is null`),
    index('notifications_email_pending_idx')
      .on(t.companyId, t.recipientPrincipalId)
      .where(sql`${t.emailStatus} = 'pending'`),
  ],
);

/** A person's notification settings in one company (S2.9): no row means the defaults (email on). */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    companyId: companyIdColumn(),
    principalId: uuid('principal_id').notNull(),
    email: boolean('email').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.principalId] }),
    tenantForeignKey('notification_settings_principal_fk', t.companyId, t.principalId, principals),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationSetting = typeof notificationSettings.$inferSelect;
