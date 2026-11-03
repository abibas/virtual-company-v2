import { UserStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';

/** People who can sign in (global, not per company). Identity is linked through user_identities (S1). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** Stored lower-cased; the CHECK refuses anything else. */
    primaryEmail: text('primary_email').notNull().unique(),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
