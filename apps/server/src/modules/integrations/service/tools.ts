import type { ServerToolsHook } from '../../chats/index.ts';
import { mergePlans } from '../rules/plans.ts';
import { type AtlassianToolsDeps, atlassianTools } from './atlassian/hook.ts';
import { type GitHubToolsDeps, githubTools } from './github/hook.ts';
import { type SlackToolsDeps, slackTools } from './slack/hook.ts';

/**
 * The integrations module's one `ServerToolsHook` (S7.1d): the Atlassian tools (S7.1c), the GitHub tools and the Slack
 * tools (S7.1e), each offered by its part of the turn's profile and asked one after the other (one database connection),
 * their plans merged (`mergePlans`, at most the runner's `max`); a call goes to the hook that owns its tool.
 */

export type IntegrationToolsDeps = AtlassianToolsDeps & GitHubToolsDeps & SlackToolsDeps;

export const NOT_OURS = 'This tool is not one of the server’s.';

export function integrationTools(deps: IntegrationToolsDeps): ServerToolsHook {
  const hooks = [atlassianTools(deps), githubTools(deps), slackTools(deps)];
  return {
    async toolsFor(t, turn) {
      const plans = [];
      for (const hook of hooks) plans.push(await hook.toolsFor(t, turn));
      return mergePlans(plans, turn.max);
    },
    owns: (tool) => hooks.some((hook) => hook.owns(tool)),
    tool: (t, turn, call) => {
      const hook = hooks.find((one) => one.owns(call.tool));
      return hook === undefined ? Promise.resolve({ ok: false, text: NOT_OURS }) : hook.tool(t, turn, call);
    },
  };
}
