import type { AtlassianRights } from '@mwc/shared/credentials';
import type { ServerToolDef } from '@mwc/shared/harness';
import { z } from 'zod';
import { ATLASSIAN_INPUTS, type AtlassianTool } from '../../schemas/atlassian.ts';
import { isWriteTool } from './rights.ts';

/**
 * The Atlassian tools' words (S7.1c): what each one is for, as its `tools/list` entry says it, its definition for a
 * turn's spec (its input schema from its zod input), and the one line a turn's standing instructions get: what the
 * agent may do, on which site, as whom, with which tools.
 */

const info = (title: string, description: string) => ({ title, description });

/** What each tool is for. */
export const ATLASSIAN_TOOL_INFO: Readonly<Record<AtlassianTool, { title: string; description: string }>> = {
  searchJiraIssuesUsingJql: info(
    'Search Jira issues',
    'Search issues with JQL, within the projects your profile reaches. Gives each issue’s key, summary, status, ' +
      'assignee and the fields asked for, and nextPageToken for the next page.',
  ),
  getJiraIssue: info(
    'Read a Jira issue',
    'One issue: its fields, description (as Markdown), latest comments, parent, sub-tasks and links.',
  ),
  getTransitionsForJiraIssue: info(
    'Jira issue transitions',
    'The transitions an issue can take now (id, name, the status it moves to), for transitionJiraIssue.',
  ),
  getVisibleJiraProjects: info(
    'Jira projects',
    'The projects you can see within your profile’s, with their issue types.',
  ),
  lookupJiraAccountId: info('Find a Jira account', 'Jira accounts by name or email, with their account ids.'),
  addCommentToJiraIssue: info('Comment on a Jira issue', 'Adds a comment (Markdown by default) to an issue.'),
  transitionJiraIssue: info(
    'Transition a Jira issue',
    'Moves an issue with one of its transitions (getTransitionsForJiraIssue gives their ids).',
  ),
  createJiraIssue: info(
    'Create a Jira issue',
    'Creates an issue in a project with its type and summary, and optionally a description, parent, assignee, ' +
      'labels, priority and components.',
  ),
  editJiraIssue: info(
    'Edit a Jira issue',
    'Changes an issue’s summary, description or labels; nothing else. Never deletes or archives.',
  ),
  searchConfluenceUsingCql: info(
    'Search Confluence',
    'Search pages, blog posts, comments and attachments with CQL, within the spaces your profile reaches; gives ' +
      'cursor for the next page.',
  ),
  getConfluencePage: info(
    'Read a Confluence page',
    'One page: its title, space, version and body as Markdown.',
  ),
  getConfluenceSpaces: info(
    'Confluence spaces',
    'The spaces you can see within your profile’s, with their ids.',
  ),
  getPagesInConfluenceSpace: info(
    'Pages in a Confluence space',
    'A space’s pages by its id (getConfluenceSpaces gives it), with their ids, versions and parents.',
  ),
  createConfluencePage: info(
    'Create a Confluence page',
    'Creates a page in a space (its id or key), optionally under a parent page. The body is HTML (Confluence ' +
      'storage format) unless contentFormat says markdown or adf.',
  ),
  updateConfluencePage: info(
    'Update a Confluence page',
    'Replaces a page’s body (and title) as its next version; give the version you read so a change meanwhile is ' +
      'not overwritten. Never deletes.',
  ),
};

/** A tool's input schema as `tools/list` gives it: its JSON Schema without the `$schema` line. */
function inputSchema(tool: AtlassianTool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(ATLASSIAN_INPUTS[tool], {
    io: 'input',
    unrepresentable: 'any',
  });
  return schema;
}

const DEFS = new Map<AtlassianTool, ServerToolDef>();

/** A tool as a turn's spec carries it (made once). */
export function toolDef(tool: AtlassianTool): ServerToolDef {
  const made = DEFS.get(tool) ?? {
    name: tool,
    ...ATLASSIAN_TOOL_INFO[tool],
    inputSchema: inputSchema(tool),
    readOnly: !isWriteTool(tool),
  };
  DEFS.set(tool, made);
  return made;
}

const reach = (scope: AtlassianRights['jiraProjects'], everywhere: string) =>
  scope === 'all' ? everywhere : `in ${scope.join(', ')}`;

const JIRA_MAY = {
  read: 'read issues',
  changes: 'read, comment on, transition, create and edit issues',
} as const;
const CONFLUENCE_MAY = { read: 'read pages', write: 'read, create and update pages' } as const;

/**
 * The line a turn's standing instructions get with the tools: "Atlassian tools (from Most Wanted): on
 * airia.atlassian.net as Ihor Herasko, Jira: read issues in AP; Confluence: off. Your tools: getJiraIssue, …; cloudId is
 * not needed; they never delete or archive."
 */
export function atlassianLine(
  where: { readonly site: string | null; readonly account: string | null },
  rights: AtlassianRights,
  tools: readonly AtlassianTool[],
): string {
  const site = where.site ?? 'your Atlassian site';
  const as = where.account === null ? '' : ` as ${where.account.replace(/\s+/g, ' ').trim()}`;
  const jira =
    rights.jira === 'off'
      ? 'off'
      : `${JIRA_MAY[rights.jira]} ${reach(rights.jiraProjects, 'in every project')}`;
  const confluence =
    rights.confluence === 'off'
      ? 'off'
      : `${CONFLUENCE_MAY[rights.confluence]} ${reach(rights.confluenceSpaces, 'in every space')}`;
  return (
    `Atlassian tools (from Most Wanted): on ${site}${as}, Jira: ${jira}; Confluence: ${confluence}. Your tools, by ` +
    `the names of Atlassian's remote MCP: ${tools.join(', ')}; cloudId is not needed; they never delete or archive.`
  );
}

/**
 * What the offered tools are for, in a few words ("Jira and Confluence", "Jira"): the products they reach, for the line a
 * turn on a runner too old for them gets and the chat's notice.
 */
export function atlassianLabel(tools: readonly AtlassianTool[]): string {
  const products = ['Jira', 'Confluence'].filter((product) => tools.some((tool) => tool.includes(product)));
  return products.join(' and ');
}
