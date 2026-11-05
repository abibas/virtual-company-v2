import { LogoContentType } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { companies } from './companies.ts';
import { principals } from './principals.ts';
import { tenantForeignKey } from './tenant.ts';

/**
 * A company's logo, at most one per company: `company_id` is the primary key, so this tenant table has no `id` of its
 * own and no `UNIQUE(company_id, id)` (nothing points at it). The image is kept here, in Postgres (at most 1 MB); its
 * type is the one its first bytes show (PNG, JPEG or WebP), never what the upload declared. `sha256` (hex) is its
 * ETag and, cut to 16 characters, the version company responses carry. Deleting the company row deletes its logo
 * (companies are soft-deleted today, which keeps it). `updated_by_principal_id` is who set it, null for the system.
 */
export const companyLogos = pgTable(
  'company_logos',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id, { onDelete: 'cascade' }),
    contentType: text('content_type').$type<LogoContentType>().notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    updatedByPrincipalId: uuid('updated_by_principal_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantForeignKey(
      'company_logos_updated_by_principal_fk',
      t.companyId,
      t.updatedByPrincipalId,
      principals,
    ),
    check('company_logos_content_type_check', oneOf(t.contentType, LogoContentType.options)),
    check('company_logos_size_check', sql`${t.size} between 1 and ${sql.raw(String(LOGO_MAX_BYTES))}`),
    check('company_logos_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type CompanyLogo = typeof companyLogos.$inferSelect;
export type NewCompanyLogo = typeof companyLogos.$inferInsert;
