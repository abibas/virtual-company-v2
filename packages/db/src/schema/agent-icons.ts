import { AgentIconContentType } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { agents } from './org.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey } from './tenant.ts';

/**
 * An agent's uploaded icon image, at most one per agent, shaped as a machine's logo (`machine_logos`):
 * `(company_id, agent_id)` is the primary key, so it has no `id` of its own. The image is kept here (at most 1 MB,
 * PNG, JPEG, WebP or GIF as its first bytes show); `sha256` (hex) is its ETag and, cut to 16 characters, the version
 * agent responses carry while the agent's `icon_kind` is `image`. Choosing a face or an emoji removes it. Deleting the
 * agent row deletes it (agents are archived today, which keeps it). `updated_by_principal_id` is who set it.
 */
export const agentIcons = pgTable(
  'agent_icons',
  {
    companyId: companyIdColumn(),
    agentId: uuid('agent_id').notNull(),
    contentType: text('content_type').$type<AgentIconContentType>().notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    updatedByPrincipalId: uuid('updated_by_principal_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'agent_icons_pkey', columns: [t.companyId, t.agentId] }),
    tenantForeignKey('agent_icons_agent_fk', t.companyId, t.agentId, agents).onDelete('cascade'),
    tenantForeignKey('agent_icons_updated_by_principal_fk', t.companyId, t.updatedByPrincipalId, principals),
    check('agent_icons_content_type_check', oneOf(t.contentType, AgentIconContentType.options)),
    check('agent_icons_size_check', sql`${t.size} between 1 and ${sql.raw(String(LOGO_MAX_BYTES))}`),
    check('agent_icons_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type AgentIcon = typeof agentIcons.$inferSelect;
export type NewAgentIcon = typeof agentIcons.$inferInsert;
