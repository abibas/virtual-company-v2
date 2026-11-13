// The integrations module (S7): outside tools for agents, answered on the server. The Atlassian tools (S7.1c: Jira and
// Confluence, the names of Atlassian's remote MCP) and the GitHub tools (S7.1d: the names of GitHub's MCP server, and the
// per-turn sign-in for git and gh when the profile may push), each offered by its part of a turn's profile: createApp
// makes the hook with the connectors and hands it to the chats runtime as its `ServerToolsHook`.
export { type AtlassianToolsDeps, atlassianTools } from './service/atlassian/hook.ts';
export { type GitHubToolsDeps, githubTools } from './service/github/hook.ts';
export { type IntegrationToolsDeps, integrationTools } from './service/tools.ts';
