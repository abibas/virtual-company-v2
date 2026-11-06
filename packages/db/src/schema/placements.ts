import { PermissionPolicy, PlacementMode } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { PLACEMENT_PATH } from '@mwc/shared/machines';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { machines } from './machines.ts';
import { agents } from './org.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/** `<column>` is an absolute path of 1–500 characters (the limits come from `@mwc/shared/machines`). */
const absolutePath = (column: AnyPgColumn): SQL =>
  sql`char_length(${column}) between ${n(PLACEMENT_PATH.min)} and ${n(PLACEMENT_PATH.max)} and left(${column}, 1) = '/'`;

/**
 * Where an agent runs (S4.7, docs/machines.md "Placements"): a machine of the company and a mode, its home folder there
 * (its CLAUDE.md, skills and memory load from it), its Claude configuration folder and worktree root when they are not
 * the defaults, and whether its runs ask before a tool outside their rules. At most one default placement per agent;
 * runs use it from S5. A machine's removal deletes its placements; an archived agent keeps its own.
 */
export const agentPlacements = pgTable(
  'agent_placements',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    agentId: uuid('agent_id').notNull(),
    machineId: uuid('machine_id').notNull(),
    mode: text('mode').$type<PlacementMode>().notNull(),
    /** An absolute path on that machine, 1–500 characters. */
    home: text('home').notNull(),
    /** `CLAUDE_CONFIG_DIR` for its runs; null for the machine's default. */
    configDir: text('config_dir'),
    /** Where its task worktrees go; null for the default under its home. */
    worktreeRoot: text('worktree_root'),
    permissionPolicy: text('permission_policy').$type<PermissionPolicy>().notNull().default('ask'),
    isDefault: boolean('is_default').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('agent_placements', t),
    tenantForeignKey('agent_placements_agent_fk', t.companyId, t.agentId, agents),
    tenantForeignKey('agent_placements_machine_fk', t.companyId, t.machineId, machines),
    check('agent_placements_mode_check', oneOf(t.mode, PlacementMode.options)),
    check('agent_placements_permission_policy_check', oneOf(t.permissionPolicy, PermissionPolicy.options)),
    check('agent_placements_home_check', absolutePath(t.home)),
    check('agent_placements_config_dir_check', absolutePath(t.configDir)),
    check('agent_placements_worktree_root_check', absolutePath(t.worktreeRoot)),
    uniqueIndex('agent_placements_one_default_idx').on(t.companyId, t.agentId).where(sql`${t.isDefault}`),
    index('agent_placements_machine_idx').on(t.companyId, t.machineId),
  ],
);

export type AgentPlacement = typeof agentPlacements.$inferSelect;
export type NewAgentPlacement = typeof agentPlacements.$inferInsert;
