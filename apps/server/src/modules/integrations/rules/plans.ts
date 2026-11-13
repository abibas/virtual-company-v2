import { TURN_TOOLS_MAX } from '@mwc/shared/flows';
import type { ServerToolsPlan } from '../../chats/index.ts';

/**
 * One plan of the server's tools from each outside tool's (S7.1d: Atlassian's and GitHub's, in that order): their tools
 * one after the other (at most `TURN_TOOLS_MAX`, which every runner that takes them parses), their lines one under the
 * other, their labels in one sentence ("Jira, Confluence and GitHub"), and GitHub's sign-in for git and what pushing
 * waits for.
 */

/** Labels in one sentence: each label's own "a and b" taken apart, then "a, b and c". */
export function joinLabels(labels: readonly string[]): string | undefined {
  const words = labels.flatMap((label) => label.split(' and ')).filter((word) => word !== '');
  if (words.length === 0) return undefined;
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The plans as one (see above). */
export function mergePlans(plans: readonly ServerToolsPlan[]): ServerToolsPlan {
  const offering = plans.filter((plan) => plan.tools.length > 0);
  const tools = offering.flatMap((plan) => plan.tools).slice(0, TURN_TOOLS_MAX);
  if (tools.length === 0) return { tools: [] };
  const lines = offering.map((plan) => plan.instructions).filter((line) => line !== undefined);
  const label = joinLabels(offering.map((plan) => plan.label).filter((one) => one !== undefined));
  const github = offering.find((plan) => plan.github !== undefined)?.github;
  const pushLabel = offering.find((plan) => plan.pushLabel !== undefined)?.pushLabel;
  return {
    tools,
    ...(lines.length === 0 ? {} : { instructions: lines.join('\n') }),
    ...(label === undefined ? {} : { label }),
    ...(github === undefined ? {} : { github }),
    ...(pushLabel === undefined ? {} : { pushLabel }),
  };
}
