import { ApiKeyKind } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { machines } from './machines.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/**
 * Service credentials (`mwc_<pk|rk|sc>_<secret>`, shown once): only the SHA-256 of the secret is stored, as
 * 64 lower-case hex digits, with a short `prefix` to recognize the key by. A runner key is bound to its
 * machine (`machine_id`, a composite key into `machines`, S4.2), whose enroller owns it.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    /** Whose key it is (the person who made it, or the machine's enroller). */
    principalId: uuid('principal_id').notNull(),
    kind: text('kind').$type<ApiKeyKind>().notNull(),
    /** What its owner calls it ("laptop", "CI"). */
    name: text('name').notNull(),
    machineId: uuid('machine_id'),
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull().unique(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('api_keys', t),
    tenantForeignKey('api_keys_principal_fk', t.companyId, t.principalId, principals),
    tenantForeignKey('api_keys_machine_fk', t.companyId, t.machineId, machines),
    check('api_keys_kind_check', oneOf(t.kind, ApiKeyKind.options)),
    check('api_keys_secret_hash_check', sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check('api_keys_runner_machine_check', sql`${t.kind} <> 'runner' or ${t.machineId} is not null`),
    index('api_keys_principal_idx').on(t.companyId, t.principalId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
