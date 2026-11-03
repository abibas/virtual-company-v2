import { CompanyStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { users } from './users.ts';

/**
 * The tenant root. Every tenant table carries `company_id` and `UNIQUE(company_id, id)`, and child
 * foreign keys are composite `(company_id, parent_id)`. Companies are soft-deleted (`deleted_at`).
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** Lower-case kebab, 1–63 characters, no leading or trailing dash. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').$type<CompanyStatus>().notNull().default('provisioning'),
    identityProvider: text('identity_provider').notNull().default('clerk'),
    /** The provider's organization id (a Clerk Organization); set once the provider has it. */
    identityOrgId: text('identity_org_id').unique(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('companies_slug_check', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('companies_status_check', oneOf(t.status, CompanyStatus.options)),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
