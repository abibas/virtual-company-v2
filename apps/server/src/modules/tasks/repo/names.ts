import { agents, memberships, type TenantDb } from '@mwc/db';
import { eq, inArray } from 'drizzle-orm';

/**
 * Who the principals a flow or a task names are, read only (the org module owns these rows): the agents' names and
 * slugs and the people's users, archived agents and former members included, so a flow's history keeps its names.
 */

/** The agents of these principals: their names and slugs. */
function agentsOf(t: TenantDb, ids: readonly string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  const fields = { principalId: agents.principalId, name: agents.name, slug: agents.slug };
  return t.selectFields(agents, fields, inArray(agents.principalId, [...ids]));
}

/** The memberships of these principals: whose person they are. */
function membersOf(t: TenantDb, ids: readonly string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  const fields = { principalId: memberships.principalId, userId: memberships.userId };
  return t.selectFields(memberships, fields, inArray(memberships.principalId, [...ids]));
}

/** The principal of the agent with this slug, if any (archived ones too). */
async function agentBySlug(t: TenantDb, slug: string): Promise<string | undefined> {
  const [row] = await t.selectFields(agents, { principalId: agents.principalId }, eq(agents.slug, slug));
  return row?.principalId;
}

export const nameRows = { agentsOf, membersOf, agentBySlug };
