import { agents, memberships, type TenantDb } from '@mwc/db';
import { inArray } from 'drizzle-orm';

/**
 * Who principals are, for their names (`service/names.ts`): the agents' names and slugs and the people's users,
 * archived agents and former members included, so a history keeps its names.
 */
export const nameRows = {
  /** The agents of these principals: their names and slugs. */
  agentNames(t: TenantDb, ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    const fields = { principalId: agents.principalId, name: agents.name, slug: agents.slug };
    return t.selectFields(agents, fields, inArray(agents.principalId, [...ids]));
  },

  /** The memberships of these principals: whose person they are. */
  memberUsers(t: TenantDb, ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    const fields = { principalId: memberships.principalId, userId: memberships.userId };
    return t.selectFields(memberships, fields, inArray(memberships.principalId, [...ids]));
  },
};
