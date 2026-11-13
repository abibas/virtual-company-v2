// The integrations module (S7): outside tools for agents. Since S7.1c the Atlassian tools (Jira and Confluence, the names
// of Atlassian's remote MCP), offered by a turn's profile's Atlassian part and answered on the server: createApp makes
// the hook with the Atlassian connector and hands it to the chats runtime as its `ServerToolsHook`.
export { type AtlassianToolsDeps, atlassianTools } from './service/atlassian/hook.ts';
