import type { z } from 'zod';
import { AGENT_TOOL_INPUTS, type AgentTool } from './tools.ts';

/**
 * The one check of an agents' tool's input (S6a), run by the runner before it relays a call and by the server again
 * before it decides: the parsed input, or words that say what to fix, one issue per line with where, so the agent fixes
 * its input and calls again. `issueLines` is shared with the runner's question tool, which keeps its own heading.
 */

/** A tool's parsed input. */
export type ToolInput<T extends AgentTool = AgentTool> = z.output<(typeof AGENT_TOOL_INPUTS)[T]>;

/** A schema issue as the lines read it. */
export interface InputIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The most issues the lines name. */
const ISSUE_LINES_MAX = 10;

/** A bad input's issues, one per line with where (`questions.0.options: …`); at most ten. */
export function issueLines(issues: readonly InputIssue[]): string {
  return issues
    .slice(0, ISSUE_LINES_MAX)
    .map((issue) => {
      const where = issue.path.map(String).join('.');
      return where === '' ? issue.message : `${where}: ${issue.message}`;
    })
    .join('\n');
}

/** A call's input checked: the parsed input, or the words that say what to fix. A missing input is an empty one. */
export function checkToolInput<T extends AgentTool>(
  tool: T,
  input: unknown,
): { readonly ok: true; readonly input: ToolInput<T> } | { readonly ok: false; readonly error: string } {
  const parsed = AGENT_TOOL_INPUTS[tool].safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `${tool} did nothing; fix its input and call it again:\n${issueLines(parsed.error.issues)}`,
    };
  }
  return { ok: true, input: parsed.data as ToolInput<T> };
}
