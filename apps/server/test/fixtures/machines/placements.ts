/**
 * The placements tests' helpers (S4.7): the API's path, a company with an agent and an enrolled machine, a placement
 * set through the API (the test fails on anything but a 200), and the stored placements of an agent.
 */
import { agentPlacements, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { asc, eq } from 'drizzle-orm';
import type { PlacementView } from '../../../src/modules/machines/schemas/placement.ts';
import { as, type MembersCompany, membersCompany } from '../members/members.ts';
import type { AgentDetailView } from '../org.ts';
import { makeAgent } from '../org.ts';
import type { AuthWorld, Person } from '../platform/auth.ts';
import { enroll } from './machines.ts';

export type { PlacementView };

export const placementPath = (company: Pick<MembersCompany, 'companyId'>, agentId: string) =>
  `/api/companies/${company.companyId}/agents/${agentId}/placement`;

/** A placement body on `machineId`: in a folder on the machine. */
export const onHost = (machineId: string, fields: Record<string, unknown> = {}) => ({
  machineId,
  mode: 'host',
  home: '/Users/ihor/agents/slop-box',
  ...fields,
});

/** A company with an agent made by its owner and This Mac enrolled. */
export async function placementWorld(w: AuthWorld): Promise<{
  readonly company: MembersCompany;
  readonly agent: AgentDetailView;
  readonly machineId: string;
}> {
  const company = await membersCompany(w);
  const agent = await makeAgent(w, company, company.owner);
  const { machineId } = await enroll(w, company);
  return { company, agent, machineId };
}

/** Sets an agent's placement through the API as `person` (the company's owner by default). */
export async function place(
  w: AuthWorld,
  company: MembersCompany,
  agentId: string,
  body: Record<string, unknown>,
  person: Person = company.owner,
): Promise<PlacementView> {
  const res = await as(w, person)('PUT', placementPath(company, agentId), body);
  if (res.status !== 200)
    throw new Error(`PUT placement answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as PlacementView;
}

/** Every stored placement of an agent, oldest first. */
export const placementsOfAgent = (db: DbHandle, agentId: string) =>
  rawDb(db)
    .select()
    .from(agentPlacements)
    .where(eq(agentPlacements.agentId, agentId))
    .orderBy(asc(agentPlacements.createdAt));
