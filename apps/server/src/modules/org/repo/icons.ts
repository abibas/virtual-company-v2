import { type AgentIcon, agentIcons, type TenantDb } from '@mwc/db';
import { eq } from 'drizzle-orm';

/**
 * The agents' uploaded icons (`agent_icons`, one per agent), through the company's tenant only. Every read but `file`
 * leaves the bytes out, so a list of agents never loads an image.
 */

/** An icon to store: the bytes, the type they show, their size and SHA-256, and who set it. */
export type AgentIconValues = Pick<
  AgentIcon,
  'contentType' | 'bytes' | 'size' | 'sha256' | 'updatedByPrincipalId'
>;

const ofAgent = (agentId: string) => eq(agentIcons.agentId, agentId);

export const agentIconRows = {
  /** The SHA-256 of the agent's image, or null when it has none. */
  async hash(t: TenantDb, agentId: string): Promise<string | null> {
    const [row] = await t.selectFields(agentIcons, { sha256: agentIcons.sha256 }, ofAgent(agentId));
    return row?.sha256 ?? null;
  },

  /** Every image's SHA-256 in the company, by agent. */
  async hashes(t: TenantDb): Promise<Map<string, string>> {
    const rows = await t.selectFields(agentIcons, { agentId: agentIcons.agentId, sha256: agentIcons.sha256 });
    return new Map(rows.map((row) => [row.agentId, row.sha256]));
  },

  /** The agent's image with its bytes, or undefined when it has none. */
  async file(t: TenantDb, agentId: string): Promise<AgentIcon | undefined> {
    const [row] = await t.select(agentIcons, ofAgent(agentId));
    return row;
  },

  /** Stores the agent's image, replacing the one there was. */
  async save(t: TenantDb, agentId: string, values: AgentIconValues): Promise<void> {
    await t.insert(agentIcons, { agentId, ...values }).onConflictDoUpdate({
      target: [agentIcons.companyId, agentIcons.agentId],
      set: { ...values, updatedAt: new Date() },
    });
  },

  /** Removes the agent's image; returns the SHA-256 it had, or null when there was none. */
  async remove(t: TenantDb, agentId: string): Promise<string | null> {
    const [row] = await t.delete(agentIcons, ofAgent(agentId)).returning({ sha256: agentIcons.sha256 });
    return row?.sha256 ?? null;
  },
};
