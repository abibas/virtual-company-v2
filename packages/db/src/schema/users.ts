import { UserStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';

/**
 * People who can sign in (global, not per company). A person is who `user_identities` says, never an
 * email: two users may share an email (an account deleted at the provider and signed up again).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** Stored lower-cased; the CHECK refuses anything else. Not unique, and never used to link anything. */
    primaryEmail: text('primary_email').notNull(),
    displayName: text('display_name').notNull(),
    imageUrl: text('image_url'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_primary_email_lower_check', sql`${t.primaryEmail} = lower(${t.primaryEmail})`),
    check('users_status_check', oneOf(t.status, UserStatus.options)),
  ],
);

/**
 * How a person signs in: one row per `(issuer, subject)` of a verified token, the identity key. `provider`
 * is the identity provider's kind (`clerk`, later `oidc`).
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('user_identities_issuer_subject_unique').on(t.issuer, t.subject),
    index('user_identities_user_id_idx').on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
