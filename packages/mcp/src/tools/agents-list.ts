import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Agent, getChart, listAgents } from '@mwc/cli/api/org';
import { refusal } from '@mwc/cli/api/session';
import { agentsText, companyJson, principalNames } from '@mwc/cli/org/render';
import { answer, inCompany, type ToolDeps, toolError } from './result.ts';

export const AGENTS_LIST_DESCRIPTION =
  'The AI agents of your company in Most Wanted Corp and how each is set up. Returns two texts. First a readable ' +
  'table: name, slug, role, status, the model and effort of its access profile ("default" for the provider\'s ' +
  'own, "no profile" when it has none) and whom it reports to (by name; "-" for nobody, "(off the chart)" when its ' +
  'manager is not on the chart), or a sentence when there are none. Then compact JSON {company: {id, slug, name}, ' +
  "agents: [...]} with each agent's id, principalId (the id the org chart and reportsTo use), name, slug, roleTitle, " +
  'status (active, paused or archived), harness (claude_code or codex), runsWith ({model, effort, provider} of its ' +
  "access profile, model and effort null for the provider's default; null without a profile; efforts low to max for " +
  'Claude, low to ultra for OpenAI), maxConcurrentRuns, reportsTo (a principalId or null), reportsToName and title ' +
  '(its title on the chart, or null). By default the active and paused agents; archived agents are off the chart ' +
  'and report to nobody.';

export const STATUS_DESCRIPTION =
  'Which agents to list: "active", "paused", "archived" or "all"; leave it out for the active and paused ones.';

/** An agent as the tool's JSON gives it: its setup (its profile's model and effort) and its place, with its manager's name. */
export function compactAgent(agent: Agent, names: ReadonlyMap<string, string>) {
  const { id, principalId, name, slug, roleTitle, status, harness, runsWith, maxConcurrentRuns } = agent;
  const { reportsTo, title } = agent;
  const reportsToName = reportsTo === null ? null : (names.get(reportsTo) ?? null);
  return {
    id,
    principalId,
    name,
    slug,
    roleTitle,
    status,
    harness,
    runsWith,
    maxConcurrentRuns,
    reportsTo,
    reportsToName,
    title,
  };
}

/** `agents_list`: the company's agents from `GET /api/companies/:companyId/agents`, with their managers' names. */
export function agentsList(
  deps: ToolDeps,
  args: { readonly company?: string | undefined; readonly status?: string | undefined },
): Promise<CallToolResult> {
  return inCompany(deps, args.company, async ({ server, key, company }) => {
    const [agents, chart] = await Promise.all([
      listAgents(deps.fetch, server, key, company.companyId, args.status),
      getChart(deps.fetch, server, key, company.companyId),
    ]);
    if (!agents.ok) return toolError(refusal(server, agents));
    if (!chart.ok) return toolError(refusal(server, chart));
    const names = principalNames(chart.body);
    const table = agentsText(company, agents.body, chart.body, args.status);
    const text = agents.body.length === 0 ? table : `Agents of ${company.name} (${company.slug}):\n${table}`;
    return answer(text, {
      company: companyJson(company),
      agents: agents.body.map((a) => compactAgent(a, names)),
    });
  });
}
