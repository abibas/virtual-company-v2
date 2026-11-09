import { LogoContentType } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { machines } from './machines.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey } from './tenant.ts';

/**
 * A machine's logo, at most one per machine, shaped as a company's (`company_logos`): `(company_id, machine_id)` is
 * the primary key, so it has no `id` of its own. The image is kept here (at most 1 MB, PNG, JPEG or WebP as its first
 * bytes show); `sha256` (hex) is its ETag and, cut to 16 characters, the version machine responses carry. Deleting
 * the machine row deletes its logo (machines are soft-deleted today, which keeps it). `updated_by_principal_id` is
 * who set it, null for the system.
 */
export const machineLogos = pgTable(
  'machine_logos',
  {
    companyId: companyIdColumn(),
    machineId: uuid('machine_id').notNull(),
    contentType: text('content_type').$type<LogoContentType>().notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    updatedByPrincipalId: uuid('updated_by_principal_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'machine_logos_pkey', columns: [t.companyId, t.machineId] }),
    tenantForeignKey('machine_logos_machine_fk', t.companyId, t.machineId, machines).onDelete('cascade'),
    tenantForeignKey(
      'machine_logos_updated_by_principal_fk',
      t.companyId,
      t.updatedByPrincipalId,
      principals,
    ),
    check('machine_logos_content_type_check', oneOf(t.contentType, LogoContentType.options)),
    check('machine_logos_size_check', sql`${t.size} between 1 and ${sql.raw(String(LOGO_MAX_BYTES))}`),
    check('machine_logos_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type MachineLogo = typeof machineLogos.$inferSelect;
export type NewMachineLogo = typeof machineLogos.$inferInsert;
