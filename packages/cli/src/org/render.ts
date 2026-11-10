/**
 * The org chart and the agents as plain text, never coloured, so a terminal, a pipe and a file get the same: an
 * indented tree and an aligned table. `mwc org tree`, `mwc agents list` and the `@mwc/mcp` tools print these;
 * exported as `@mwc/cli/org/render`.
 */
import type { Agent, ChartNode, OrgChart, RunsWith, TreeEntry } from '../api/org.ts';

/** The company a text is about, as `GET /api/me` names it. */
export interface CompanyRef {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
}

/** What marks an agent in the tree. */
export const AGENT_MARK = '◆';
/** What marks a top entry whose manager is not on the chart. */
export const ORPHAN_MARK = '[orphan]';

/** The company as JSON outputs show it. */
export const companyJson = (company: CompanyRef) => ({
  id: company.companyId,
  slug: company.slug,
  name: company.name,
});

/** What the chart calls a principal: a person's display name (their email when they have none), an agent's name. */
export function nodeName(node: ChartNode): string {
  return node.kind === 'person' ? node.person.displayName?.trim() || node.person.email : node.agent.name;
}

/** Every principal on the chart by its id, with its `nodeName`. */
export function principalNames(chart: OrgChart): ReadonlyMap<string, string> {
  return new Map(chart.nodes.map((node) => [node.principalId, nodeName(node)]));
}

/** What an agent without an access profile runs: nothing yet. */
export const NO_PROFILE = 'no profile';

/** What an agent runs, as the tree and the table say it: its profile's model or `default`, and the same of its effort. */
export function runsParts(runsWith: RunsWith | null): { readonly model: string; readonly effort: string } {
  if (runsWith === null) return { model: NO_PROFILE, effort: '-' };
  return { model: runsWith.model ?? 'default', effort: runsWith.effort ?? 'default' };
}

function nodeParts(node: ChartNode): string[] {
  if (node.kind === 'person') {
    return [nodeName(node), ...(node.title ? [node.title] : []), node.person.role];
  }
  const { agent } = node;
  const runs = runsParts(agent.runsWith);
  const runsOn = agent.runsWith === null ? NO_PROFILE : `${runs.model}/${runs.effort}`;
  return [`${AGENT_MARK} ${agent.name}`, agent.roleTitle, agent.status, runsOn];
}

/**
 * One entry of the tree: `Olga · CEO · owner`, `◆ SLOP BOX · Coder · active · claude-opus-5-5/xhigh` (its access
 * profile's model and effort, `default` for the provider's, `no profile` without one).
 */
export function nodeLabel(node: ChartNode | undefined, entry: TreeEntry): string {
  const label = node === undefined ? `? ${entry.principalId}` : nodeParts(node).join(' · ');
  return entry.orphan ? `${label} ${ORPHAN_MARK}` : label;
}

/** The tree, one line per principal, its reports below it with `├──`, `└──` and `│` guides. */
export function treeLines(chart: OrgChart): string[] {
  const nodes = new Map(chart.nodes.map((node) => [node.principalId, node]));
  const lines: string[] = [];
  const walk = (entry: TreeEntry, lead: string, branch: string, below: string) => {
    lines.push(`${lead}${branch}${nodeLabel(nodes.get(entry.principalId), entry)}`);
    entry.children.forEach((child, i) => {
      const last = i === entry.children.length - 1;
      walk(child, lead + below, last ? '└── ' : '├── ', last ? '    ' : '│   ');
    });
  };
  for (const top of chart.tree) walk(top, '', '', '');
  return lines;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `Acme (acme): 2 people, 3 agents` and the tree below it. */
export function chartText(company: CompanyRef, chart: OrgChart): string {
  const people = chart.nodes.filter((node) => node.kind === 'person').length;
  const agents = chart.nodes.length - people;
  const head = `${company.name} (${company.slug}): ${count(people, 'person', 'people')}, ${count(agents, 'agent', 'agents')}`;
  const lines = treeLines(chart);
  return `${[head, ...(lines.length > 0 ? lines : ['Nobody is on the chart yet.'])].join('\n')}\n`;
}

/** Whom an agent reports to, by name: `-` for nobody (an archived agent), `(off the chart)` for an id the chart lacks. */
export function managerLabel(agent: Agent, names: ReadonlyMap<string, string>): string {
  if (agent.reportsTo === null) return '-';
  return names.get(agent.reportsTo) ?? '(off the chart)';
}

/** Rows of cells as columns two spaces apart, each as wide as its widest cell; no trailing spaces. */
export function alignRows(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    for (const [i, cell] of row.entries()) widths[i] = Math.max(widths[i] ?? 0, cell.length);
  }
  const line = (row: readonly string[]) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');
  return rows.map((row) => `${line(row).trimEnd()}\n`).join('');
}

const HEADERS = ['NAME', 'SLUG', 'ROLE', 'STATUS', 'MODEL', 'EFFORT', 'REPORTS TO'];

/** Which agents a status filter shows, as the empty list says it. */
const filtered = (status: string | undefined) =>
  status === undefined ? 'active or paused agents' : status === 'all' ? 'agents' : `${status} agents`;

/**
 * The agents as a table (name, slug, role, status, model and effort of its access profile, reports to), or a sentence
 * when there are none.
 */
export function agentsText(
  company: CompanyRef,
  agents: readonly Agent[],
  chart: OrgChart,
  status?: string,
): string {
  if (agents.length === 0) return `No ${filtered(status)} in ${company.name} (${company.slug}).\n`;
  const names = principalNames(chart);
  return alignRows([
    HEADERS,
    ...agents.map((a) => {
      const runs = runsParts(a.runsWith);
      return [a.name, a.slug, a.roleTitle, a.status, runs.model, runs.effort, managerLabel(a, names)];
    }),
  ]);
}
