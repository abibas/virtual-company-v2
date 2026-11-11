import { TOOLS_ENV } from '@mwc/harness-core';
import { AGENT_TOOL_INFO, AGENT_TOOL_INPUTS, AgentTool, READ_TOOLS, TURN_TOOLS_MAX } from '@mwc/shared/flows';
import { z } from 'zod';

/**
 * The agents' tools a turn's MCP server offers besides its question tool (S6a, docs/harness.md "Agents' tools"): a task
 * step's by its kind, a flow Lead's in its own chats, as the server named them in the turn's spec (`TurnSpec.tools`)
 * and the runner passed them to the MCP server (`MWC_TOOLS`). Their `tools/list` entries are built from the shared
 * inputs (`AGENT_TOOL_INPUTS`, as JSON Schema) and words (`AGENT_TOOL_INFO`); a call's input is checked against the same
 * schema before it is relayed, and the server checks it again with who may do what.
 */

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

/** What a bad input's issues say, one per line with where (`name`), so the agent fixes it and calls again. */
function issuesText(
  tool: AgentTool,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  const lines = issues.slice(0, 10).map((issue) => {
    const where = issue.path.map(String).join('.');
    return where === '' ? issue.message : `${where}: ${issue.message}`;
  });
  return `${tool} did nothing; fix its input and call it again:\n${lines.join('\n')}`;
}

/** A call's input checked: the parsed input, or the words that say what to fix. */
export function checkToolInput(
  tool: AgentTool,
  input: unknown,
):
  | { readonly ok: true; readonly input: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  const parsed = AGENT_TOOL_INPUTS[tool].safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: issuesText(tool, parsed.error.issues) };
  return { ok: true, input: parsed.data as Record<string, unknown> };
}
