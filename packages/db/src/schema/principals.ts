import { PrincipalKind } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { companyIdColumn, tenantKey } from './tenant.ts';

/**
 * The one id space of a company's actors: a person (through their membership) or an agent (S2). Every
 * actor and assignee column points here, with a composite foreign key `(company_id, principal_id)`.
 */
export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    kind: text('kind').$type<PrincipalKind>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [tenantKey('principals', t), check('principals_kind_check', oneOf(t.kind, PrincipalKind.options))],
);

export type Principal = typeof principals.$inferSelect;
export type NewPrincipal = typeof principals.$inferInsert;
