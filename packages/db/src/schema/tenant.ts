import { type AnyPgColumn, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies.ts';

/**
 * The tenant conventions as helpers (packages/db/README.md): every tenant table has `company_id` and
 * `UNIQUE(company_id, id)`, and a child points at its parent with the composite `(company_id, parent_id)`,
 * so a row can never reference a row of another company.
 */

/** `company_id uuid not null references companies(id)`: the tenant column. */
export const companyIdColumn = () =>
  uuid('company_id')
    .notNull()
    .references(() => companies.id);

/** `UNIQUE(company_id, id)`: the key composite foreign keys point at. */
export function tenantKey(table: string, t: { readonly companyId: AnyPgColumn; readonly id: AnyPgColumn }) {
  return unique(`${table}_company_id_id_unique`).on(t.companyId, t.id);
}

/** `(company_id, column) → parent(company_id, id)`; a null `column` points nowhere (MATCH SIMPLE). */
export function tenantForeignKey(
  name: string,
  companyId: AnyPgColumn,
  column: AnyPgColumn,
  parent: { readonly companyId: AnyPgColumn; readonly id: AnyPgColumn },
) {
  return foreignKey({ name, columns: [companyId, column], foreignColumns: [parent.companyId, parent.id] });
}
