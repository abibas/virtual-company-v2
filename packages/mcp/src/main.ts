/** The mwc MCP server over stdio, for `claude mcp add mwc -- node <repo>/packages/mcp/src/main.ts` (docs/mcp.md). */
import { serveStdio } from './server.ts';

await serveStdio({ env: process.env, fetch: globalThis.fetch });
