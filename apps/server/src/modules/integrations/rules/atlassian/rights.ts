import type { AtlassianRights } from '@mwc/shared/credentials';
import {
  type AtlassianTool,
  CONFLUENCE_READ_TOOLS,
  CONFLUENCE_WRITE_TOOLS,
  JIRA_CHANGE_TOOLS,
  JIRA_READ_TOOLS,
} from '../../schemas/atlassian.ts';

/**
 * Which Atlassian tools a profile's Atlassian part gives (S7.1c), and the server's check of each call against it: Jira's
 * read tools while Jira is `read` or `changes`, its change tools only with `changes`; Confluence's read tools while it is
 * `read` or `write`, its write tools only with `write`; a product with no project or space chosen gives none. A refusal
 * is a sentence the agent reads. The project and space allowlists are checked per call by the tools (`query.ts` scopes
 * a search; an issue's project, a page's space).
 */

type Scope = AtlassianRights['jiraProjects'];

const has = (list: readonly string[], tool: AtlassianTool) => list.includes(tool);
const reaches = (scope: Scope) => scope === 'all' || scope.length > 0;

export const isJiraTool = (tool: AtlassianTool) => has(JIRA_READ_TOOLS, tool) || has(JIRA_CHANGE_TOOLS, tool);
export const isWriteTool = (tool: AtlassianTool) =>
  has(JIRA_CHANGE_TOOLS, tool) || has(CONFLUENCE_WRITE_TOOLS, tool);

/** The tools the rights give, in a fixed order. */
export function offeredTools(rights: AtlassianRights): AtlassianTool[] {
  const jira: AtlassianTool[] =
    rights.jira === 'off' || !reaches(rights.jiraProjects) ? [] : [...JIRA_READ_TOOLS];
  if (jira.length > 0 && rights.jira === 'changes') jira.push(...JIRA_CHANGE_TOOLS);
  const confluence: AtlassianTool[] =
    rights.confluence === 'off' || !reaches(rights.confluenceSpaces) ? [] : [...CONFLUENCE_READ_TOOLS];
  if (confluence.length > 0 && rights.confluence === 'write') confluence.push(...CONFLUENCE_WRITE_TOOLS);
  return [...jira, ...confluence];
}

/** Why the rights refuse the tool now, or undefined when they give it. */
export function toolRefusal(tool: AtlassianTool, rights: AtlassianRights): string | undefined {
  if (isJiraTool(tool)) {
    if (rights.jira === 'off') return "Jira is off for this agent's profile.";
    if (has(JIRA_CHANGE_TOOLS, tool) && rights.jira !== 'changes')
      return "Jira changes are off for this agent's profile: it may only read.";
    if (!reaches(rights.jiraProjects)) return "This agent's profile reaches no Jira project.";
    return undefined;
  }
  if (rights.confluence === 'off') return "Confluence is off for this agent's profile.";
  if (has(CONFLUENCE_WRITE_TOOLS, tool) && rights.confluence !== 'write')
    return "Confluence writing is off for this agent's profile: it may only read.";
  if (!reaches(rights.confluenceSpaces)) return "This agent's profile reaches no Confluence space.";
  return undefined;
}

/** True when the scope holds the key (project keys and space keys compare as stored: upper-case projects). */
export const inScope = (scope: Scope, key: string | null): boolean =>
  scope === 'all' || (key !== null && scope.includes(key));

/** The scope in words: "AP, SS". */
export const scopeWords = (scope: readonly string[]) => scope.join(', ');

/** An issue outside the profile's projects. */
export const outsideProjects = (what: string, project: string | null, scope: readonly string[]) =>
  `${what} is in ${project === null ? 'no project' : `project ${project}`}, outside the Jira projects this agent's ` +
  `profile reaches (${scopeWords(scope)}).`;

/** A page or space outside the profile's spaces. */
export const outsideSpaces = (what: string, space: string | null, scope: readonly string[]) =>
  `${what} is in ${space === null ? 'no space' : `space ${space}`}, outside the Confluence spaces this agent's ` +
  `profile reaches (${scopeWords(scope)}).`;
