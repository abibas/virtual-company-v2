import type { Agent, Membership, OrgPosition, TenantDb } from '@mwc/db';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import type { OrgRepo } from '../repo.ts';
import type { ChartNode } from '../rules/chart.ts';
import type { OrgState } from '../rules/placement.ts';
import { buildTree, validateChart } from '../rules.ts';
import type { ChartNodeView, OrgChartView } from '../schemas.ts';
import { loadOrg } from './read.ts';

/** One node of the chart with what the web shows of it, so the chart needs no other call. */
function nodeView(org: OrgState, node: ChartNode, profiles: ReadonlyMap<string, UserProfile>): ChartNodeView {
  const position = org.positions.get(node.principalId) as OrgPosition;
  const base = { principalId: node.principalId, reportsTo: node.reportsTo, title: position.title };
  if (node.kind === 'person') {
    const member = org.members.get(node.principalId) as Membership;
    const profile = profiles.get(member.userId);
    const { displayName, primaryEmail: email } = profile ?? { displayName: '', primaryEmail: '' };
    return {
      ...base,
      kind: 'person',
      person: { userId: member.userId, displayName, email, role: member.role },
    };
  }
  const {
    id: agentId,
    name,
    slug,
    roleTitle,
    status,
    face,
    model,
    effort,
  } = org.agents.get(node.principalId) as Agent;
  return { ...base, kind: 'agent', agent: { agentId, name, slug, roleTitle, status, face, model, effort } };
}

/**
 * Reads the company's chart for `GET /org/chart`: every active member's and every agent's place (archived agents
 * have none) with their display data, and the same as a tree (`buildTree`). A stored chart that breaks an invariant
 * is still answered, its orphans flagged in the tree, and logged at warn level once per company until its flaws
 * change. People's names and emails come from the identity module's service, read outside any transaction.
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
    const profiles = await profilesOf(deps.db, userIds);
    warnOnce(t.companyId, org.chart);
    return { nodes: org.chart.map((node) => nodeView(org, node, profiles)), tree: buildTree(org.chart) };
  };
}
