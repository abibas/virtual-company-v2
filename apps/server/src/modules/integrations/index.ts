// The integrations module (S7): outside tools for agents, answered on the server. The Atlassian tools (S7.1c: Jira and
// Confluence, the names of Atlassian's remote MCP) and the GitHub tools (S7.1d: the names of GitHub's MCP server, and the
// per-turn sign-in for git and gh when the profile may push) and the Slack tools (S7.1e: the Slack MCP servers' names),
// each offered by its part of a turn's profile: createApp
// makes the hook with the connectors and hands it to the chats runtime as its `ServerToolsHook`. Since 2026-11-13 it also
// receives Slack messages: the Socket Mode connections (`slackInbound`, started by `app.ts`), the answers posted back
// (`slackReplies`, the chats' `InboundTurnHook`) and a bot sign-in's inbound settings (`integrationsRoutes`).

export { type IntegrationsRouteDeps, integrationsRoutes } from './routes.ts';
export { type AtlassianToolsDeps, atlassianTools } from './service/atlassian/hook.ts';
export { type GitHubToolsDeps, githubTools } from './service/github/hook.ts';
export { type SlackToolsDeps, slackTools } from './service/slack/hook.ts';
export {
  type ConnectionsDeps,
  type SlackInbound,
  slackInbound,
} from './service/slack/inbound/connections.ts';
export { slackReplies } from './service/slack/inbound/reply.ts';
export { slackReceiving } from './service/slack/inbound/start.ts';
export { type IntegrationToolsDeps, integrationTools } from './service/tools.ts';
