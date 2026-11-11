import type { Agent, OrgPosition, TenantDb } from '@mwc/db';
import { agentIconView } from '@mwc/shared/agent-icons';
import { type OrgRepo, orgRepo } from '../repo.ts';
import { type OrgState, orgState } from '../rules/placement.ts';
import type { AgentProfileView, RunsWithView } from '../schemas/profiles.ts';
import type { AgentDetailView, AgentPlacementSummaryView, AgentView, PositionView } from '../schemas.ts';

/** The company's chart as stored (in the caller's transaction when it is one). */
export async function loadOrg(repo: OrgRepo, t: TenantDb): Promise<OrgState> {
  // One after the other: a transaction runs its statements in turn.
  const positions = await repo.positions(t);
  const members = await repo.activeMembers(t);
  return orgState(positions, members, await repo.liveAgents(t));
}

/**
 * The company's live chart for another module (the tasks module's flows: who is on the chart, who leads a team), read
 * through `t` (in the caller's transaction when it is one).
 */
export const orgOf = (t: TenantDb): Promise<OrgState> => loadOrg(orgRepo(), t);

type Place = Pick<OrgPosition, 'reportsToPrincipalId' | 'title'> | undefined;

/**
 * What an agent's views show beside its own row: its image's hash (for its icon), its access profile and what that runs (`profileExtras`), and where it
 * runs (the machines module's).
 */
export interface AgentExtras {
  /** Its image's SHA-256 (`agent_icons`), null or undefined for none: its icon's version. */
  readonly iconHash: string | null | undefined;
  readonly profile: AgentProfileView | null;
  readonly runsWith: RunsWithView | null;
  readonly placement: AgentPlacementSummaryView | null;
}

/**
 * An agent as lists show it, with its place on the chart (none once archived), its access profile and the model and
 * effort that runs (`profile`, `runsWith`, read by `profileRefs`) and where it runs (`placement`, from the machines
 * module): never its instructions.
 */
export function agentView(agent: Agent, place: Place, extras: AgentExtras): AgentView {
  return {
    id: agent.id,
    principalId: agent.principalId,
    name: agent.name,
    slug: agent.slug,
    roleTitle: agent.roleTitle,
    status: agent.status,
    harness: agent.harness,
    instructionsRev: agent.instructionsRev,
    maxConcurrentRuns: agent.maxConcurrentRuns,
    face: agent.face,
    icon: agentIconView(agent.iconKind, agent.iconEmoji, extras.iconHash),
    reportsTo: place?.reportsToPrincipalId ?? null,
    title: place?.title ?? null,
    profile: extras.profile,
    runsWith: extras.runsWith,
    placement: extras.placement,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

/** One agent with its standing instructions. */
export function agentDetail(agent: Agent, place: Place, extras: AgentExtras): AgentDetailView {
  return { ...agentView(agent, place, extras), instructions: agent.instructions };
}

/** A place on the chart as the API shows it. */
export function positionView(position: OrgPosition): PositionView {
  return {
    principalId: position.principalId,
    reportsTo: position.reportsToPrincipalId,
    title: position.title,
  };
}
