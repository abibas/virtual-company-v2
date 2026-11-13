import { z } from 'zod';
import { ASK_TOOL } from '../chats.ts';
import { AgentTool, TURN_TOOLS_MAX } from '../flows/tools.ts';
import { JsonObject, protocolObject } from '../runner-protocol/common.ts';

/**
 * The server's own tools (S7.1c, docs/harness.md "Server tools"): tools the server defines whole (name, words, input
 * schema) and answers itself, which a runner only lists in its MCP server and relays (`turn.tool`), so a new one needs
 * no new runner. The first are the Atlassian tools (docs/subscriptions.md "Atlassian tools"), whose names are Atlassian's
 * remote MCP's (`searchJiraIssuesUsingJql`, `getJiraIssue`, …), so they may be camelCase. A runner checks nothing of
 * their input but that it is an object: the server checks it, with who may do what.
 */

/** A server tool's name: a letter, then letters, digits and `_`, up to 64 (one plain word on any harness). */
export const SERVER_TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const ServerToolName = z.string().regex(SERVER_TOOL_NAME_PATTERN, 'a tool name');

/** The longest words a server tool carries, and its input schema's size as JSON. */
export const SERVER_TOOL_LIMITS = { title: 100, description: 2000, schema: 16 * 1024 } as const;

/** The names a server tool never takes: the runner's question tool and the agents' tools (S6a). */
export const RESERVED_TOOL_NAMES: readonly string[] = [ASK_TOOL, ...AgentTool.options];

/** One server tool as a turn's spec carries it, and as the runner's `tools/list` gives it (`readOnly` as its hint). */
export const ServerToolDef = protocolObject({
  name: ServerToolName,
  title: z.string().min(1).max(SERVER_TOOL_LIMITS.title),
  description: z.string().min(1).max(SERVER_TOOL_LIMITS.description),
  inputSchema: JsonObject.refine(
    (schema) => JSON.stringify(schema).length <= SERVER_TOOL_LIMITS.schema,
    `an input schema of at most ${SERVER_TOOL_LIMITS.schema} characters`,
  ),
  readOnly: z.boolean(),
});
export type ServerToolDef = z.infer<typeof ServerToolDef>;

/** A turn's server tools: at most `TURN_TOOLS_MAX`, each name once and none of the reserved ones. */
export const ServerToolDefs = z
  .array(ServerToolDef)
  .max(TURN_TOOLS_MAX)
  .refine((tools) => new Set(tools.map((tool) => tool.name)).size === tools.length, 'each tool once')
  .refine(
    (tools) => tools.every((tool) => !RESERVED_TOOL_NAMES.includes(tool.name)),
    'no reserved tool name',
  );
export type ServerToolDefs = z.infer<typeof ServerToolDefs>;
