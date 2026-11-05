import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ChartNode, getChart } from '@mwc/cli/api/org';
import { refusal } from '@mwc/cli/api/session';
import { chartText, companyJson, nodeName } from '@mwc/cli/org/render';
import { answer, inCompany, type ToolDeps, toolError } from './result.ts';

export const ORG_CHART_DESCRIPTION =
  'The org chart of your company in Most Wanted Corp: every active person and every AI agent that is not archived, ' +
  'and who reports to whom. Returns two texts. First a readable indented tree: a person as "name · title · role", an ' +
  'agent as "◆ name · role title · status · model/effort", "[orphan]" after someone whose manager is not on the ' +
  'chart. Then compact JSON {company: {id, slug, name}, nodes: [...]}, one node per principal in chart order with ' +
  'principalId, kind ("person" or "agent"), reportsTo (the principalId of their manager, null at the top), title ' +
  '(their title on the chart, or null) and orphan: true when it applies; a person adds name, email and role (owner, ' +
  'admin, member, viewer), an agent adds agentId, name, slug, roleTitle, status (active or paused), model and ' +
  "effort. Use it to answer who works for whom, who leads an agent, and who is on a team. By default the key's own " +
  'company.';

export const COMPANY_DESCRIPTION =
  "A company slug (or id) to read; leave it out for the key's own company. A personal API key reaches one company.";

/** A node as the tool's JSON gives it: the chart's fields without the drawn face or the user id. */
export function compactNode(node: ChartNode, orphans: ReadonlySet<string>) {
  const place = {
    principalId: node.principalId,
    kind: node.kind,
    reportsTo: node.reportsTo,
    title: node.title,
    ...(orphans.has(node.principalId) ? { orphan: true } : {}),
  };
  if (node.kind === 'person') {
    return { ...place, name: nodeName(node), email: node.person.email, role: node.person.role };
  }
  const { agentId, name, slug, roleTitle, status, model, effort } = node.agent;
  return { ...place, agentId, name, slug, roleTitle, status, model, effort };
}

/** `org_chart`: the company's chart from `GET /api/companies/:companyId/org/chart`, as a tree and as compact JSON. */
export function orgChart(
  deps: ToolDeps,
  args: { readonly company?: string | undefined },
): Promise<CallToolResult> {
  return inCompany(deps, args.company, async ({ server, key, company }) => {
    const chart = await getChart(deps.fetch, server, key, company.companyId);
    if (!chart.ok) return toolError(refusal(server, chart));
    const orphans = new Set(chart.body.tree.filter((top) => top.orphan).map((top) => top.principalId));
    const nodes = chart.body.nodes.map((node) => compactNode(node, orphans));
    return answer(chartText(company, chart.body), { company: companyJson(company), nodes });
  });
}
