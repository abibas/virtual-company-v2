import {
  type Agent,
  type AgentPlacement,
  agentPlacements,
  agents,
  isUuid,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

/**
 * Agents' placements (S4.7), through the company's tenant only: an agent's default placement, every default of the
 * company, a machine's, and the agents a placement is for (read only: the agents are the org module's).
 */

const isDefault = eq(agentPlacements.isDefault, true);

/** The agent's id and status; undefined for an unknown, malformed or another company's id. */
async function agentOf(t: TenantDb, id: string): Promise<Pick<Agent, 'id' | 'status'> | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.selectFields(agents, { id: agents.id, status: agents.status }, eq(agents.id, id));
  return row;
}

/** The agent's default placement, if it has one. */
async function defaultOf(t: TenantDb, agentId: string): Promise<AgentPlacement | undefined> {
  const [row] = await t.select(agentPlacements, and(eq(agentPlacements.agentId, agentId), isDefault));
  return row;
}

/** Every default placement of the company. */
const defaults = (t: TenantDb): Promise<AgentPlacement[]> => t.select(agentPlacements, isDefault);

/** How many agents not archived have their default placement on each machine (machines with none left out). */
async function agentCounts(t: TenantDb): Promise<Map<string, number>> {
  const live = await t.selectFields(agents, { id: agents.id }, ne(agents.status, 'archived'));
  const counts = new Map<string, number>();
  if (live.length === 0) return counts;
  const ids = live.map((row) => row.id);
  const rows = await t.selectFields(
    agentPlacements,
    { machineId: agentPlacements.machineId },
    and(isDefault, inArray(agentPlacements.agentId, ids)),
  );
  for (const { machineId } of rows) counts.set(machineId, (counts.get(machineId) ?? 0) + 1);
  return counts;
}

async function insert(t: TenantDb, values: TenantValues<typeof agentPlacements>): Promise<AgentPlacement> {
  const [row] = (await t.insert(agentPlacements, values).returning()) as [AgentPlacement];
  return row;
}

async function update(
  t: TenantDb,
  id: string,
  set: TenantSet<typeof agentPlacements>,
): Promise<AgentPlacement> {
  const [row] = (await t.update(agentPlacements, set, eq(agentPlacements.id, id)).returning()) as [
    AgentPlacement,
  ];
  return row;
}

/** Deletes one placement. */
async function remove(t: TenantDb, id: string): Promise<void> {
  await t.delete(agentPlacements, eq(agentPlacements.id, id));
}

/** Deletes every placement on the machine; returns them as they were. */
const removeForMachine = (t: TenantDb, machineId: string): Promise<AgentPlacement[]> =>
  t.delete(agentPlacements, eq(agentPlacements.machineId, machineId)).returning();

export const placementsRepo = {
  agentOf,
  defaultOf,
  defaults,
  agentCounts,
  insert,
  update,
  remove,
  removeForMachine,
};

export type PlacementsRepo = typeof placementsRepo;
