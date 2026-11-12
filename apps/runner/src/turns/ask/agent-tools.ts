import { TOOLS_ENV } from '@mwc/harness-core';
import { AGENT_TOOL_INFO, AGENT_TOOL_INPUTS, AgentTool, READ_TOOLS, TURN_TOOLS_MAX } from '@mwc/shared/flows';
import { z } from 'zod';

/**
 * The agents' tools a turn's MCP server offers besides its question tool (S6a, docs/harness.md "Agents' tools"): a task
 * step's by its kind, a flow Lead's in its own chats, as the server named them in the turn's spec (`TurnSpec.tools`)
 * and the runner passed them to the MCP server (`MWC_TOOLS`). Their `tools/list` entries are built from the shared
 * inputs (`AGENT_TOOL_INPUTS`, as JSON Schema) and words (`AGENT_TOOL_INFO`); a call's input is checked against the same
 * schema before it is relayed (`checkToolInput`, shared with the server), and the server checks it again with who may
 * do what.
 */

/** A call's input checked before it is relayed: the same check the server runs again. */
export { checkToolInput } from '@mwc/shared/flows';

/** The agents' tools of a list of names: the ones this runner knows, each once, in order; at most `TURN_TOOLS_MAX`. */
export function knownTools(names: readonly string[]): AgentTool[] {
  const known: AgentTool[] = [];
  for (const name of names) {
    const tool = AgentTool.safeParse(name);
    if (tool.success && !known.includes(tool.data)) known.push(tool.data);
  }
  return known.slice(0, TURN_TOOLS_MAX);
}

/** The agents' tools the MCP server's environment names (`MWC_TOOLS`, comma-joined); none without it. */
export const toolsFromEnv = (env: Readonly<Record<string, string | undefined>>): AgentTool[] =>
  knownTools((env[TOOLS_ENV] ?? '').split(',').map((name) => name.trim()));

/** A tool's input schema as `tools/list` gives it: its JSON Schema, without the `$schema` line. */
function inputSchema(tool: AgentTool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(AGENT_TOOL_INPUTS[tool], {
    io: 'input',
    unrepresentable: 'any',
  });
  return schema;
}

/** A tool's `tools/list` entry. */
export function agentToolDefinition(tool: AgentTool) {
  const { title, description } = AGENT_TOOL_INFO[tool];
  const readOnly = READ_TOOLS.includes(tool);
  return {
    name: tool,
    title,
    description,
    inputSchema: inputSchema(tool),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
  };
}
