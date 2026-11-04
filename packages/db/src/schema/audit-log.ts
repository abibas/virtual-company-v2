import { ActorKind } from '@mwc/shared/enums';
import { bigserial, check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf } from './columns.ts';
import { companies } from './companies.ts';
import { principals } from './principals.ts';
import { tenantForeignKey } from './tenant.ts';

/**
 * Append-only change log: one row per changed field (see `diffFields`). `company_id` is null for
 * global events such as a user's own changes. `actor_principal_id` points at a principal of the same
 * company (composite key; a global event has none).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    companyId: uuid('company_id').references(() => companies.id),
    actorKind: text('actor_kind').$type<ActorKind>().notNull(),
    actorPrincipalId: uuid('actor_principal_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    field: text('field'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    check('audit_log_actor_kind_check', oneOf(t.actorKind, ActorKind.options)),
    index('audit_log_entity_idx').on(t.companyId, t.entityType, t.entityId, t.id),
    tenantForeignKey('audit_log_actor_principal_fk', t.companyId, t.actorPrincipalId, principals),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
