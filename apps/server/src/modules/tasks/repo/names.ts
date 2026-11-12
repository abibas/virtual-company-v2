import { agents, type TenantDb } from '@mwc/db';
import { eq, inArray } from 'drizzle-orm';

/**
 * Which agents a flow or a task names, read only (the org module owns these rows, and reads the principals' names:
 * `principalNames`): an agent's principal by its slug or its id, archived agents included.
 */

/** The principal of the agent with this slug, if any (archived ones too). */
async function agentBySlug(t: TenantDb, slug: string): Promise<string | undefined> {
  const [row] = await t.selectFields(agents, { principalId: agents.principalId }, eq(agents.slug, slug));
  return row?.principalId;
}

/** The principals of these agents (by the agents' ids; archived ones too). */
function agentPrincipals(t: TenantDb, agentIds: readonly string[]) {
  if (agentIds.length === 0) return Promise.resolve([]);
  return t.selectFields(
    agents,
    { id: agents.id, principalId: agents.principalId },
    inArray(agents.id, [...agentIds]),
  );
}

export const nameRows = { agentBySlug, agentPrincipals };
