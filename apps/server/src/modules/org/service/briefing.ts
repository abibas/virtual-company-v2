import type { Agent, Membership, OrgPosition, TenantDb } from '@mwc/db';
import {
  agentBriefing,
  type Briefing,
  type BriefingNode,
  standingInstructions,
} from '@mwc/shared/agent-briefing';
import { type BriefingTool, TOOL_PROVIDERS } from '@mwc/shared/credentials';
import type { ChartNode } from '@mwc/shared/org-chart';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import { type OrgRepo, orgRepo } from '../repo.ts';
import type { OrgState } from '../rules/placement.ts';
import { profileExtras, profileRefs } from './profiles.ts';
import { loadOrg } from './read.ts';

/**
 * An agent's briefing (docs/harness.md, "Standing instructions"): `agentBriefing` of `@mwc/shared/agent-briefing` over
 * the company's live chart, read as `GET /org/chart` reads it (every active member and every agent not archived, the
 * titles on the chart, people's display names from the identity module, read outside any transaction), the company's
 * name, and the tool parts of the agent's access profile (S7.1b, one profile since 2026-11-13: who each acts as, and
 * its rights). The web writes the same text from the chart it shows.
 */

/** What the briefing reads of an agent: its principal and its access profile. */
type BriefedAgent = Pick<Agent, 'principalId' | 'profileId'>;

/** The tool parts of the agent's access profile as the briefing reads them, GitHub's then Atlassian's. */
async function toolsOf(deps: Pick<ServerDeps, 'db'>, repo: OrgRepo, t: TenantDb, agent: BriefedAgent) {
  if (agent.profileId === null) return [];
  const { profile } = profileExtras(await profileRefs(deps, repo, t, [agent.profileId]), agent.profileId);
  if (profile === null) return [];
  return TOOL_PROVIDERS.flatMap((provider): BriefingTool[] => {
    const part = profile.tools[provider];
    return part === null ? [] : [{ provider, ...part }];
  });
}

/** A chart node with what the briefing reads of it. */
function briefingNode(
  org: OrgState,
  node: ChartNode,
  people: ReadonlyMap<string, UserProfile>,
): BriefingNode {
  const { title } = org.positions.get(node.principalId) as OrgPosition;
  const base = { principalId: node.principalId, reportsTo: node.reportsTo, title };
  if (node.kind === 'person') {
    const member = org.members.get(node.principalId) as Membership;
    return {
      ...base,
      kind: 'person',
      person: { displayName: people.get(member.userId)?.displayName ?? null },
    };
  }
  const { name, roleTitle, status } = org.agents.get(node.principalId) as Agent;
  return { ...base, kind: 'agent', agent: { name, roleTitle, status } };
}

/** Reads an agent's briefing now; an archived agent (off the chart) is told only that. */
export function briefingReader(deps: Pick<ServerDeps, 'db'>, repo: OrgRepo) {
  return async (t: TenantDb, agent: BriefedAgent): Promise<Briefing> => {
    const org = await loadOrg(repo, t);
    const userIds = org.chart.flatMap((node) => org.members.get(node.principalId)?.userId ?? []);
    const people = await profilesOf(deps.db, userIds);
    const nodes = org.chart.map((node) => briefingNode(org, node, people));
    const tools = await toolsOf(deps, repo, t, agent);
    return agentBriefing({ company: t.company.name, nodes, principalId: agent.principalId, tools });
  };
}

/**
 * What every turn and terminal of an agent carries as standing instructions (the chats module's, when it resolves one):
 * its briefing now, then its own instructions.
 */
export function standingReader(deps: Pick<ServerDeps, 'db'>) {
  const read = briefingReader(deps, orgRepo());
  return async (t: TenantDb, agent: BriefedAgent & Pick<Agent, 'instructions'>): Promise<string> =>
    standingInstructions((await read(t, agent)).text, agent.instructions);
}
