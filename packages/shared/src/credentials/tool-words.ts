import type { ToolProvider } from '../enums.ts';
import { effectiveSlackRights, slackChannelWords } from './slack.ts';
import type { AtlassianRights, GitHubRights, SlackRights, ToolRights } from './tool-rights.ts';

/**
 * A profile's tool parts' rights in words (S7.1b, one profile since 2026-11-13): the short summary the pages show beside
 * the profile ("push, PRs · AiriaLLC/*", "Jira read (AP) · Confluence write") and the line each tool part adds to the
 * agent's briefing, what it may do there and as whom, and which of Most Wanted's tools use it (Atlassian's since S7.1c,
 * GitHub's since S7.1d, with git and gh on the machine when it may push; Slack's since S7.1e). Pure, so the server and the
 * web write the same words.
 */

/** The most names a summary shows; the rest are counted ("+3"). */
export const SUMMARY_NAMES_MAX = 3;

/** The most names a briefing line lists; the rest are counted ("and 3 more"). */
export const BRIEFING_NAMES_MAX = 25;

/** What ends GitHub's briefing line (S7.1d): its tools are Most Wanted's, by the names of GitHub's MCP server. */
export const GITHUB_TOOLS_NOTE =
  'Use it with your Most Wanted tools, named as on GitHub’s MCP server (search_pull_requests, pull_request_read, ' +
  'create_pull_request, …)';

/** What GitHub's line adds when the part may push: git and gh on the machine get the sign-in in its turns (S7.1d). */
export const GITHUB_PUSH_NOTE = '; in your turns git and gh on your machine use it too';

/** What ends Atlassian's briefing line (S7.1c): its tools are Most Wanted's, by the names of Atlassian's remote MCP. */
export const ATLASSIAN_TOOLS_NOTE =
  'Use it with your Most Wanted tools, named as on Atlassian’s remote MCP (searchJiraIssuesUsingJql, ' +
  'getJiraIssue, getConfluencePage, …).';

/** What ends Slack's briefing line (S7.1e): its tools, by the names of the Slack MCP servers. */
export const SLACK_TOOLS_NOTE =
  'Your Most Wanted tools: slack_get_channel_history, slack_post_message, …; never @here, @channel or @everyone.';

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

/** "read, post · #general, #dev": what it may do (else "off"), and in which channels. */
function slackSummary(rights: SlackRights): string {
  const can = [
    rights.read ? 'read' : '',
    rights.post ? 'post' : '',
    rights.react ? 'react' : '',
    rights.search ? 'search' : '',
    rights.dms === 'off' ? '' : `DMs ${rights.dms}`,
  ].filter((word) => word !== '');
  const channels =
    rights.channels === 'all' ? rights.channels : rights.channels.map((one) => slackChannelWords(one));
  const where = shortScope(channels, { all: 'all channels', none: 'no channels' });
  return `${can.length === 0 ? 'off' : can.join(', ')} · ${where}`;
}

/** A tool part's rights in a few words, as the pages show them beside the profile. */
export function rightsSummary(rights: ToolRights): string {
  if ('repos' in rights) return githubSummary(rights);
  return 'channels' in rights ? slackSummary(rights) : atlassianSummary(rights);
}

/** A profile's tool part as an agent's briefing reads it: its tool, who its sign-in acts as and where, and its rights. */
export interface BriefingTool {
  readonly provider: ToolProvider;
  /** Who the sign-in acts as (`toolAccountOf`); null when the part has no sign-in now. */
  readonly account: string | null;
  /** The Atlassian site; null for GitHub. */
  readonly site: string | null;
  readonly rights: ToolRights;
  /** Slack: a user token, which posts as that person (`toolAccountOf`). */
  readonly asUser?: boolean | undefined;
  /** Slack: the token's scopes, which cap its rights; left out, the rights are read as given. */
  readonly scopes?: readonly string[] | undefined;
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

/** Names in a list: "#a, #b"; past `BRIEFING_NAMES_MAX`, "#a, #b and 3 more". */
function listed(items: readonly string[]): string {
  const shown = items.slice(0, BRIEFING_NAMES_MAX).join(', ');
  const more = items.length - BRIEFING_NAMES_MAX;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** Slack's line: as whom and where, then what it may read and post and where, DMs, search and reactions. */
function slackLine(tool: BriefingTool, account: string): string {
  const kind = tool.asUser ? 'slack_user_token' : 'slack_bot_token';
  const given = tool.rights as SlackRights;
  const rights = tool.scopes === undefined ? given : effectiveSlackRights(given, kind, tool.scopes);
  const who = tool.asUser ? `${account}'s own account (posts show as that person)` : account;
  const where = tool.site === null ? '' : ` in ${tool.site}`;
  const channels =
    rights.channels === 'all'
      ? 'every channel'
      : rights.channels.length === 0
        ? 'no channel'
        : listed(rights.channels.map(slackChannelWords));
  const may = [
    rights.read ? `may read ${channels}` : '',
    rights.post ? `may post in ${channels}` : '',
    rights.react ? 'may add reactions there' : '',
    rights.search ? 'may search messages' : '',
    rights.dms === 'off' ? '' : `may ${rights.dms === 'post' ? 'read and send' : 'read'} direct messages`,
  ].filter((part) => part !== '');
  return `as ${who}${where}; ${may.length === 0 ? 'may do nothing there' : may.join('; ')}`;
}

/**
 * The briefing's line for one tool part: "- GitHub: as ihorherasko; may read, push branches and open and update pull
 * requests in AiriaLLC/*; never merges, ...", then which tools use it (and, for a GitHub part that pushes, git and gh in
 * its turns); a part with no sign-in says it gives no access.
 */
export function toolBriefingLine(tool: BriefingTool): string {
  const name =
    tool.provider === 'github'
      ? 'GitHub'
      : tool.provider === 'slack'
        ? 'Slack'
        : `Atlassian${tool.site === null ? '' : ` (${tool.site})`}`;
  // One line of words: a name with a newline in it cannot start a line of its own.
  const account = tool.account?.replace(/\s+/g, ' ').trim() ?? '';
  if (account === '') return `- ${name}: your profile has no sign-in for it now, so no access.`;
  if (tool.provider === 'slack') {
    const site = tool.site?.replace(/\s+/g, ' ').trim() || null;
    return `- ${name}: ${slackLine({ ...tool, site }, account)}. ${SLACK_TOOLS_NOTE}`;
  }
  if (!('repos' in tool.rights))
    return `- ${name}: ${atlassianLine(account, tool.rights as AtlassianRights)}. ${ATLASSIAN_TOOLS_NOTE}`;
  const rights = tool.rights as GitHubRights;
  const pushes = rights.push && (rights.repos === 'all' || rights.repos.length > 0);
  return `- ${name}: ${githubLine(account, rights)}. ${GITHUB_TOOLS_NOTE}${pushes ? GITHUB_PUSH_NOTE : ''}.`;
}
