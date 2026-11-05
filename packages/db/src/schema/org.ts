import { AgentStatus, Effort, Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/**
 * The org structure (S2): the company's agents and everyone's place on its chart.
 *
 * An agent is a principal of kind `agent`, one agent per principal. SQL cannot check the principal's kind from here
 * (a CHECK sees only its own row), so the org service checks it when it creates the agent.
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    principalId: uuid('principal_id').notNull(),
    /** What people call it ("SLOP BOX"), 1–80 characters. */
    name: text('name').notNull(),
    /** Lower-case kebab, 1–63 characters, no leading or trailing dash (as company slugs); unique in the company. */
    slug: text('slug').notNull(),
    /** Its job on the chart ("Coder"), 1–80 characters. */
    roleTitle: text('role_title').notNull(),
    status: text('status').$type<AgentStatus>().notNull().default('active'),
    harness: text('harness').$type<Harness>().notNull().default('claude_code'),
    /** The harness's model id (`claude-opus-5-5`). */
    model: text('model').notNull(),
    effort: text('effort').$type<Effort>().notNull().default('high'),
    /** Its standing instructions (the system prompt's own part); `instructions_rev` counts their versions. */
    instructions: text('instructions').notNull().default(''),
    instructionsRev: integer('instructions_rev').notNull().default(1),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(1),
    /** The web's drawn face (`AgentFace`): 7 colours × 6 features, 0–41. */
    face: smallint('face').notNull().default(0),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('agents', t),
    unique('agents_company_id_principal_id_unique').on(t.companyId, t.principalId),
    unique('agents_company_id_slug_unique').on(t.companyId, t.slug),
    tenantForeignKey('agents_principal_fk', t.companyId, t.principalId, principals),
    check('agents_name_check', sql`char_length(${t.name}) between 1 and 80`),
    check('agents_slug_check', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('agents_role_title_check', sql`char_length(${t.roleTitle}) between 1 and 80`),
    check('agents_status_check', oneOf(t.status, AgentStatus.options)),
    check('agents_harness_check', oneOf(t.harness, Harness.options)),
    check('agents_effort_check', oneOf(t.effort, Effort.options)),
    check('agents_instructions_rev_check', sql`${t.instructionsRev} >= 1`),
    check('agents_max_concurrent_runs_check', sql`${t.maxConcurrentRuns} between 1 and 8`),
    check('agents_face_check', sql`${t.face} between 0 and 41`),
  ],
);

/**
 * A principal's place on the company's chart, at most one per principal (person or agent): whom it reports to (null
 * at the root) and its title there. SQL holds only what one row shows: both principals belong to the company, and
 * nobody reports to themselves. The rules across rows (no cycles, an agent is never a root, an agent's chain reaches
 * a person, an agent never manages a person) are the org rules' (`apps/server/src/modules/org/rules.ts`, S2.2),
 * enforced by the org service (S2.3) when a position changes.
 */
export const orgPositions = pgTable(
  'org_positions',
  {
    companyId: companyIdColumn(),
    principalId: uuid('principal_id').notNull(),
    reportsToPrincipalId: uuid('reports_to_principal_id'),
    /** The title on the chart ("CTO"), at most 80 characters; none by default. */
    title: text('title'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'org_positions_pkey', columns: [t.companyId, t.principalId] }),
    tenantForeignKey('org_positions_principal_fk', t.companyId, t.principalId, principals),
    tenantForeignKey('org_positions_reports_to_fk', t.companyId, t.reportsToPrincipalId, principals),
    check('org_positions_not_self_check', sql`${t.principalId} <> ${t.reportsToPrincipalId}`),
    check('org_positions_title_check', sql`char_length(${t.title}) <= 80`),
    index('org_positions_reports_to_idx').on(t.companyId, t.reportsToPrincipalId),
  ],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type OrgPosition = typeof orgPositions.$inferSelect;
export type NewOrgPosition = typeof orgPositions.$inferInsert;
