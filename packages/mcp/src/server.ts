/**
 * The mwc MCP server for a person's own Claude Code (docs/mcp.md): read-only tools over the mwc API with their personal
 * API key. `createMcpServer` registers the tools on the SDK's `McpServer` (`registerTool`); `serveStdio` connects it
 * to standard input and output, which `main.ts` does for Claude Code. Exported as `@mwc/mcp/server`.
 */
import type { Readable, Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { AGENT_FILTERS } from '@mwc/cli/api/org';
import { z } from 'zod';
import manifest from '../package.json' with { type: 'json' };
import { AGENTS_LIST_DESCRIPTION, agentsList, STATUS_DESCRIPTION } from './tools/agents-list.ts';
import { ME_DESCRIPTION, me } from './tools/me.ts';
import { COMPANY_DESCRIPTION, ORG_CHART_DESCRIPTION, orgChart } from './tools/org-chart.ts';
import type { ToolDeps } from './tools/result.ts';

export type McpDeps = ToolDeps;

/** What the server tells Claude about itself when it connects. */
export const INSTRUCTIONS =
  'Most Wanted Corp is an organization of people and AI agents. These tools read it with your personal API key ' +
  '(from `mwc login` or MWC_API_KEY): `me` says who you are and which company the key reaches, `org_chart` who ' +
  'reports to whom, `agents_list` how each agent is set up. They only read; nothing is changed or started.';

/** The tools only read the organization, the same answer each time until someone changes it. */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

const company = z.string().min(1).optional().describe(COMPANY_DESCRIPTION);
const status = z
  .enum(AGENT_FILTERS as [string, ...string[]])
  .optional()
  .describe(STATUS_DESCRIPTION);

/** The server with its three tools: `me`, `org_chart` and `agents_list`. */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: 'mwc', title: 'Most Wanted Corp', version: manifest.version },
    { instructions: INSTRUCTIONS },
  );
  server.registerTool('me', { title: 'Who am I', description: ME_DESCRIPTION, annotations: READ_ONLY }, () =>
    me(deps),
  );
  server.registerTool(
    'org_chart',
    {
      title: 'Org chart',
      description: ORG_CHART_DESCRIPTION,
      inputSchema: { company },
      annotations: READ_ONLY,
    },
    (args) => orgChart(deps, args),
  );
  server.registerTool(
    'agents_list',
    {
      title: 'Agents',
      description: AGENTS_LIST_DESCRIPTION,
      inputSchema: { company, status },
      annotations: READ_ONLY,
    },
    (args) => agentsList(deps, args),
  );
  return server;
}

/** Standard input and output, or streams in tests. */
export interface StdioStreams {
  readonly stdin: Readable;
  readonly stdout: Writable;
}

/** Serves the tools over stdio (`claude mcp add mwc -- node .../main.ts`); resolves once connected. */
export async function serveStdio(
  deps: McpDeps,
  streams: StdioStreams = { stdin: process.stdin, stdout: process.stdout },
): Promise<McpServer> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport(streams.stdin, streams.stdout));
  return server;
}
