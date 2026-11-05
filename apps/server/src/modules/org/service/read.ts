import type { Agent, OrgPosition, TenantDb } from '@mwc/db';
import type { OrgRepo } from '../repo.ts';
import { type OrgState, orgState } from '../rules/placement.ts';
import type { AgentDetailView, AgentView, PositionView } from '../schemas.ts';

/** The company's chart as stored (in the caller's transaction when it is one). */
export async function loadOrg(repo: OrgRepo, t: TenantDb): Promise<OrgState> {
  // One after the other: a transaction runs its statements in turn.
  const positions = await repo.positions(t);
  const members = await repo.activeMembers(t);
  return orgState(positions, members, await repo.liveAgents(t));
}

type Place = Pick<OrgPosition, 'reportsToPrincipalId' | 'title'> | undefined;

/** An agent as lists show it, with its place on the chart (none once archived): never its instructions. */
export function agentView(agent: Agent, place: Place): AgentView {
  return {
    id: agent.id,
    principalId: agent.principalId,
    name: agent.name,
    slug: agent.slug,
    roleTitle: agent.roleTitle,
    status: agent.status,
    harness: agent.harness,
    model: agent.model,
    effort: agent.effort,
    instructionsRev: agent.instructionsRev,
    maxConcurrentRuns: agent.maxConcurrentRuns,
    face: agent.face,
    reportsTo: place?.reportsToPrincipalId ?? null,
    title: place?.title ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

/** One agent with its standing instructions. */
export function agentDetail(agent: Agent, place: Place): AgentDetailView {
  return { ...agentView(agent, place), instructions: agent.instructions };
}

/** A place on the chart as the API shows it. */
export function positionView(position: OrgPosition): PositionView {
  return {
    principalId: position.principalId,
    reportsTo: position.reportsToPrincipalId,
    title: position.title,
  };
}
