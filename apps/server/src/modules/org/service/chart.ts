import type { Agent, Membership, OrgPosition, TenantDb } from '@mwc/db';
import { buildTree, type ChartNode, validateChart } from '@mwc/shared/org-chart';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import { type PlacementSummary, placementsOf } from '../../machines/service/placement.ts';
import type { OrgRepo } from '../repo.ts';
import type { OrgState } from '../rules/placement.ts';
import type { ChartNodeView, OrgChartView } from '../schemas.ts';
import { agentIconHashes, iconOf } from './icons.ts';
import { type ProfileRef, profileExtras, profileRefs } from './profiles.ts';
import { loadOrg } from './read.ts';

/** Who a member is when their profile is missing (never, while `memberships.user_id` keeps its key). */
const UNKNOWN_PERSON = { displayName: null, primaryEmail: '', imageUrl: null } as const;

/**
 * What a node shows besides the chart: people's profiles by user id, agents' access profiles by id, and where agents
 * run by agent id.
 */
interface Shown {
  readonly people: ReadonlyMap<string, UserProfile>;
  readonly profiles: ReadonlyMap<string, ProfileRef>;
  readonly placements: ReadonlyMap<string, PlacementSummary>;
  /** Agents' image hashes by agent id, for their icons. */
  readonly icons: ReadonlyMap<string, string>;
}

/**
 * One node of the chart with what the web shows of it (a person's name, email and photo, an agent's access profile and
 * the model and effort it runs), so the chart needs no other call.
 */
function nodeView(org: OrgState, node: ChartNode, shown: Shown): ChartNodeView {
  const position = org.positions.get(node.principalId) as OrgPosition;
  const base = { principalId: node.principalId, reportsTo: node.reportsTo, title: position.title };
  if (node.kind === 'person') {
    const member = org.members.get(node.principalId) as Membership;
    const { displayName, primaryEmail: email, imageUrl } = shown.people.get(member.userId) ?? UNKNOWN_PERSON;
    return {
      ...base,
      kind: 'person',
      person: {
        userId: member.userId,
        membershipId: member.id,
        displayName,
        email,
        imageUrl,
        role: member.role,
      },
    };
  }
  const agent = org.agents.get(node.principalId) as Agent;
  const { id: agentId, name, slug, roleTitle, status, harness, face } = agent;
  const { profile, runsWith } = profileExtras(shown.profiles, agent.profileId);
  const placement = shown.placements.get(agentId) ?? null;
  const icon = iconOf(agent, shown.icons.get(agentId));
  return {
    ...base,
    kind: 'agent',
    agent: { agentId, name, slug, roleTitle, status, harness, face, icon, profile, runsWith, placement },
  };
}

/**
 * Reads the company's chart for `GET /org/chart`: every active member's and every agent's place (archived agents
 * have none) with their display data, and the same as a tree (`buildTree`). A stored chart that breaks an invariant
 * is still answered, its orphans flagged in the tree, and logged at warn level once per company until its flaws
 * change. People's names, emails and photos come from the identity module's service, read outside any transaction,
 * agents' access profiles from `profileRefs` and where they run from the machines module's service.
 */
export function chartReader(deps: Pick<ServerDeps, 'db' | 'logger'>, repo: OrgRepo) {
  const warned = new Map<string, string>();
  const warnOnce = (companyId: string, chart: readonly ChartNode[]) => {
    const violations = validateChart(chart);
    const seen = JSON.stringify(violations);
    if (violations.length === 0) warned.delete(companyId);
    else if (warned.get(companyId) !== seen) {
      warned.set(companyId, seen);
      deps.logger.warn({ companyId, violations }, 'the org chart breaks its invariants');
    }
  };
  return async (t: TenantDb): Promise<OrgChartView> => {
    const org = await loadOrg(repo, t);
    const userIds = org.chart.flatMap((node) => org.members.get(node.principalId)?.userId ?? []);
    const people = await profilesOf(deps.db, userIds);
    const profileIds = [...org.agents.values()].map((agent) => agent.profileId);
    const profiles = await profileRefs(deps, repo, t, profileIds);
    const shown = { people, profiles, placements: await placementsOf(t), icons: await agentIconHashes(t) };
    warnOnce(t.companyId, org.chart);
    return { nodes: org.chart.map((node) => nodeView(org, node, shown)), tree: buildTree(org.chart) };
  };
}
