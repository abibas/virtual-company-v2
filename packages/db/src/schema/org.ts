import { AGENT_EMOJI_MAX } from '@mwc/shared/agent-icons';
import { AgentIconKind, AgentStatus, Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import {
  AGENT_FACE,
  AGENT_MAX_CONCURRENT_RUNS,
  AGENT_NAME,
  AGENT_ROLE_TITLE,
  POSITION_TITLE_MAX,
} from '@mwc/shared/org';
import { SLUG_PATTERN } from '@mwc/shared/slugs';
import { type SQL, sql } from 'drizzle-orm';
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
import { accessProfiles } from './credentials.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/** A number written into a CHECK as it is (the limits come from `@mwc/shared/org`, which the API's schemas read too). */
const n = (value: number) => sql.raw(String(value));

/** `<value> between <min> and <max>`. */
const within = (value: SQL, range: { readonly min: number; readonly max: number }) =>
  sql`${value} between ${n(range.min)} and ${n(range.max)}`;

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
    /** What runs it: its access profile's provider's own harness, set when the profile is given (the web follows it). */
    harness: text('harness').$type<Harness>().notNull().default('claude_code'),
    /** Its standing instructions (the system prompt's own part); `instructions_rev` counts their versions. */
    instructions: text('instructions').notNull().default(''),
    instructionsRev: integer('instructions_rev').notNull().default(1),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(1),
    /** The web's drawn face (`AgentFace`): 7 colours × 6 features, 0–41. */
    face: smallint('face').notNull().default(0),
    /**
     * What stands for it on screen (migration `0020_agent_icons`): its drawn face (`face`, the default), the emoji in
     * `icon_emoji`, or its uploaded image (`agent_icons`, which the org service keeps in step: an `image` agent has one).
     */
    iconKind: text('icon_kind').$type<AgentIconKind>().notNull().default('face'),
    /** The emoji of an `emoji` icon (one grapheme, at most 16 code points), null for any other kind. */
    iconEmoji: text('icon_emoji'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * The access profile its runs use (S3.4): a person's subscription of the provider its harness runs on, given by
     * its owner, who is an admin or owner here; none by default. A personal row, so a plain key: it goes when the
     * profile does. Its model and effort are the profile's (migration `0017_profile_model`).
     */
    profileId: uuid('profile_id').references(() => accessProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('agents', t),
    unique('agents_company_id_principal_id_unique').on(t.companyId, t.principalId),
    unique('agents_company_id_slug_unique').on(t.companyId, t.slug),
    tenantForeignKey('agents_principal_fk', t.companyId, t.principalId, principals),
    check('agents_name_check', within(sql`char_length(${t.name})`, AGENT_NAME)),
    check('agents_slug_check', sql`${t.slug} ~ '${sql.raw(SLUG_PATTERN.source)}'`),
    check('agents_role_title_check', within(sql`char_length(${t.roleTitle})`, AGENT_ROLE_TITLE)),
    check('agents_status_check', oneOf(t.status, AgentStatus.options)),
    check('agents_harness_check', oneOf(t.harness, Harness.options)),
    check('agents_instructions_rev_check', sql`${t.instructionsRev} >= 1`),
    check('agents_max_concurrent_runs_check', within(sql`${t.maxConcurrentRuns}`, AGENT_MAX_CONCURRENT_RUNS)),
    check('agents_face_check', within(sql`${t.face}`, AGENT_FACE)),
    check('agents_icon_kind_check', oneOf(t.iconKind, AgentIconKind.options)),
    check('agents_icon_emoji_kind_check', sql`(${t.iconKind} = 'emoji') = (${t.iconEmoji} is not null)`),
    check('agents_icon_emoji_check', sql`char_length(${t.iconEmoji}) between 1 and ${n(AGENT_EMOJI_MAX)}`),
    index('agents_profile_idx').on(t.profileId),
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
    check('org_positions_title_check', sql`char_length(${t.title}) <= ${n(POSITION_TITLE_MAX)}`),
    index('org_positions_reports_to_idx').on(t.companyId, t.reportsToPrincipalId),
  ],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type OrgPosition = typeof orgPositions.$inferSelect;
export type NewOrgPosition = typeof orgPositions.$inferInsert;
