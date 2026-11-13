import type { ToolProvider } from '../enums.ts';
import type { AtlassianRights, GitHubRights, ToolRights } from './tool-rights.ts';

/**
 * A profile's tool parts' rights in words (S7.1b, one profile since 2026-11-13): the short summary the pages show beside
 * the profile ("push, PRs · AiriaLLC/*", "Jira read (AP) · Confluence write") and the line each tool part adds to the
 * agent's briefing, what it may do there and as whom. GitHub's tools arrive later (S7.1d), so its line says the access
 * is configured, never that a tool exists; Atlassian's are built (S7.1c), so its line names them. Pure, so the server and
 * the web write the same words.
 */

/** The most names a summary shows; the rest are counted ("+3"). */
export const SUMMARY_NAMES_MAX = 3;

/** The most names a briefing line lists; the rest are counted ("and 3 more"). */
export const BRIEFING_NAMES_MAX = 25;

/** What ends GitHub's briefing line: the access is set, the tools come later. */
export const TOOL_ACCESS_NOTE = 'Configured; the tools that use it arrive with Most Wanted’s tools.';

/** What ends Atlassian's briefing line (S7.1c): its tools are Most Wanted's, by the names of Atlassian's remote MCP. */
export const ATLASSIAN_TOOLS_NOTE =
  'Use it with your Most Wanted tools, named as on Atlassian’s remote MCP (searchJiraIssuesUsingJql, ' +
  'getJiraIssue, getConfluencePage, …).';

type Scope = 'all' | readonly string[];

/** A scope in a summary: its word for all, the first names and how many more, or its word for none. */
function shortScope(scope: Scope, words: { readonly all: string; readonly none: string }): string {
  if (scope === 'all') return words.all;
  if (scope.length === 0) return words.none;
  const shown = scope.slice(0, SUMMARY_NAMES_MAX).join(', ');
  return scope.length > SUMMARY_NAMES_MAX ? `${shown} +${scope.length - SUMMARY_NAMES_MAX}` : shown;
}

/** "push, PRs · AiriaLLC/*": what it may do besides reading (else "read"), and where. */
function githubSummary(rights: GitHubRights): string {
  const can = [rights.push ? 'push' : '', rights.pullRequests ? 'PRs' : ''].filter((word) => word !== '');
  const where = shortScope(rights.repos, { all: 'all repositories', none: 'no repositories' });
  return `${can.length === 0 ? 'read' : can.join(', ')} · ${where}`;
}

/** One Atlassian product's level, with where it reaches unless that is everywhere: "Jira read", "Confluence write (ENG)". */
function productSummary(product: string, level: string, scope: Scope, none: string): string | null {
  if (level === 'off') return null;
  return scope === 'all'
    ? `${product} ${level}`
    : `${product} ${level} (${shortScope(scope, { all: '', none })})`;
}

/** "Jira read (AP) · Confluence write": the products it may use, and "off" when it may use neither. */
function atlassianSummary(rights: AtlassianRights): string {
  const products = [
    productSummary('Jira', rights.jira, rights.jiraProjects, 'no projects'),
    productSummary('Confluence', rights.confluence, rights.confluenceSpaces, 'no spaces'),
  ].filter((product) => product !== null);
  return products.length === 0 ? 'off' : products.join(' · ');
}

/** A tool part's rights in a few words, as the pages show them beside the profile. */
export function rightsSummary(rights: ToolRights): string {
  return 'repos' in rights ? githubSummary(rights) : atlassianSummary(rights);
}

/** A profile's tool part as an agent's briefing reads it: its tool, who its sign-in acts as and where, and its rights. */
export interface BriefingTool {
  readonly provider: ToolProvider;
  /** Who the sign-in acts as (`toolAccountOf`); null when the part has no sign-in now. */
  readonly account: string | null;
  /** The Atlassian site; null for GitHub. */
  readonly site: string | null;
  readonly rights: ToolRights;
}

/** Words in a sentence: "a", "a and b", "a, b and c"; past `BRIEFING_NAMES_MAX` names, "a, b and 3 more". */
function sentence(items: readonly string[]): string {
  const shown = items.slice(0, BRIEFING_NAMES_MAX);
  const more = items.length - shown.length;
  const all = more > 0 ? [...shown, `${more} more`] : shown;
  return all.length <= 1 ? all.join('') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

/** Where a right reaches, in a sentence: everywhere, or in the names listed. */
const reach = (scope: Scope, everywhere: string) => (scope === 'all' ? everywhere : `in ${sentence(scope)}`);

/** GitHub's line: as whom, what it may do and where, and what it never does. */
function githubLine(account: string, rights: GitHubRights): string {
  if (rights.repos !== 'all' && rights.repos.length === 0) {
    return `as ${account}; no repositories are chosen, so it reaches none`;
  }
  const may = sentence([
    'read',
    ...(rights.push ? ['push branches'] : []),
    ...(rights.pullRequests ? ['open and update pull requests'] : []),
  ]);
  const where = reach(rights.repos, 'in every repository the account can see');
  return `as ${account}; may ${may} ${where}; never merges, force-pushes, deletes or pushes to a default branch`;
}

const JIRA_MAY = {
  read: 'read issues',
  changes: 'read, comment on, transition, create and edit issues',
} as const;
const CONFLUENCE_MAY = { read: 'read pages', write: 'read, create and update pages' } as const;

/** Atlassian's line: as whom, then Jira's and Confluence's access and where, and what it never does. */
function atlassianLine(account: string, rights: AtlassianRights): string {
  const jira =
    rights.jira === 'off'
      ? 'Jira: none'
      : `Jira: may ${JIRA_MAY[rights.jira]} ${reach(rights.jiraProjects, 'in every project')}`;
  const confluence =
    rights.confluence === 'off'
      ? 'Confluence: none'
      : `Confluence: may ${CONFLUENCE_MAY[rights.confluence]} ${reach(rights.confluenceSpaces, 'in every space')}`;
  return `as ${account}; ${jira}; ${confluence}; never deletes or archives`;
}

/**
 * The briefing's line for one tool part: "- GitHub: as ihorherasko; may read, push branches and open and update pull
 * requests in AiriaLLC/*; never merges, ...", then that it is configured and its tools come later (GitHub) or which
 * tools use it (Atlassian); a part with no sign-in says it gives no access.
 */
export function toolBriefingLine(tool: BriefingTool): string {
  const name =
    tool.provider === 'github' ? 'GitHub' : `Atlassian${tool.site === null ? '' : ` (${tool.site})`}`;
  // One line of words: a name with a newline in it cannot start a line of its own.
  const account = tool.account?.replace(/\s+/g, ' ').trim() ?? '';
  if (account === '') return `- ${name}: your profile has no sign-in for it now, so no access.`;
  const github = 'repos' in tool.rights;
  const rights = github
    ? githubLine(account, tool.rights as GitHubRights)
    : atlassianLine(account, tool.rights as AtlassianRights);
  return `- ${name}: ${rights}. ${github ? TOOL_ACCESS_NOTE : ATLASSIAN_TOOLS_NOTE}`;
}
