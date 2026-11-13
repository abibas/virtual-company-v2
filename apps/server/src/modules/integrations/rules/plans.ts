import type { ServerToolDef } from '@mwc/shared/harness';
import { SERVER_TOOLS_MAX } from '@mwc/shared/harness';
import type { ServerToolsPlan } from '../../chats/index.ts';

/**
 * One plan of the server's tools from each outside tool's (S7.1d: Atlassian's, GitHub's and, since S7.1e, Slack's, in
 * that order): their tools one after the other, their lines one under the other, their labels in one sentence ("Jira,
 * Confluence and GitHub"), and GitHub's sign-in for git and what pushing waits for. A turn's runner takes at most `max`
 * tools (64; an older runner 32, `serverToolsLimit`): past it, the least important are left out first (`DROP_FIRST`),
 * and a last line names them and says the runner's update brings them back.
 */

/**
 * The tools left out first when a runner takes fewer than a profile gives, least important first: lookups an agent can
 * do another way, then the rarer reads; the main reads and every write stay. Past this list, the last tools go.
 */
export const DROP_FIRST: readonly string[] = [
  'request_copilot_review',
  'slack_get_user_profile',
  'search_repositories',
  'list_branches',
  'getPagesInConfluenceSpace',
  'getConfluenceSpaces',
  'getVisibleJiraProjects',
  'lookupJiraAccountId',
  'get_commit',
  'list_commits',
  'slack_get_users',
  'slack_add_reaction',
  'getTransitionsForJiraIssue',
  'search_issues',
];

/** At most `max` of the tools, in their order: the ones `DROP_FIRST` names go first, then the last ones. */
export function fitTools(
  tools: readonly ServerToolDef[],
  max: number,
): { readonly kept: ServerToolDef[]; readonly left: string[] } {
  const left = new Set<string>();
  for (const name of DROP_FIRST) {
    if (tools.length - left.size <= max) break;
    if (tools.some((tool) => tool.name === name)) left.add(name);
  }
  const rest = tools.filter((tool) => !left.has(tool.name));
  for (const tool of rest.slice(Math.max(max, 0))) left.add(tool.name);
  return { kept: tools.filter((tool) => !left.has(tool.name)), left: [...left] };
}

/** The line a turn gets when its runner takes fewer tools than its profile gives. */
export const leftOutLine = (max: number, left: readonly string[]) =>
  `This machine's runner takes at most ${max} tools, so these are left out now: ${left.join(', ')}; tell the ` +
  'person to update the runner on the Machines page to get them.';

/** Labels in one sentence: each label's own "a and b" taken apart, then "a, b and c". */
export function joinLabels(labels: readonly string[]): string | undefined {
  const words = labels.flatMap((label) => label.split(' and ')).filter((word) => word !== '');
  if (words.length === 0) return undefined;
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The plans as one, with at most `max` tools (see above). */
export function mergePlans(plans: readonly ServerToolsPlan[], max = SERVER_TOOLS_MAX): ServerToolsPlan {
  const offering = plans.filter((plan) => plan.tools.length > 0);
  const all = offering.flatMap((plan) => plan.tools);
  if (all.length === 0) return { tools: [] };
  const { kept, left } = fitTools(all, max);
  const lines = offering.map((plan) => plan.instructions).filter((line) => line !== undefined);
  if (left.length > 0) lines.push(leftOutLine(max, left));
  const label = joinLabels(offering.map((plan) => plan.label).filter((one) => one !== undefined));
  const github = offering.find((plan) => plan.github !== undefined)?.github;
  const pushLabel = offering.find((plan) => plan.pushLabel !== undefined)?.pushLabel;
  return {
    tools: kept,
    ...(lines.length === 0 ? {} : { instructions: lines.join('\n') }),
    ...(label === undefined ? {} : { label }),
    ...(github === undefined ? {} : { github }),
    ...(pushLabel === undefined ? {} : { pushLabel }),
    ...(left.length === 0 ? {} : { leftOut: left, total: all.length }),
  };
}
