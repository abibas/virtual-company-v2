import { readFileSync } from 'node:fs';
import { type PrivateFile, SERVER_TOOLS_ENV } from '@mwc/harness-core';
import { type ServerToolDef, ServerToolDefs, ServerToolName } from '@mwc/shared/harness';

/**
 * The server's own tools a turn's MCP server offers (S7.1c, docs/harness.md "Server tools"): the server sends them whole
 * in the turn's spec (`TurnSpec.serverTools`: name, words, input schema), the runner writes them to the turn's private
 * folder (`server-tools.json`, 0600) and names that file to its MCP server (`MWC_SERVER_TOOLS`), which lists them as
 * they are and relays each call with its input unchecked but for being an object: the server checks it. So a new server
 * tool needs no new runner.
 */

/** The file in the turn's folder that holds them. */
export const SERVER_TOOLS_FILE = 'server-tools.json';

/** The turn's file of its server tools, for its folder. */
export const serverToolsFile = (tools: readonly ServerToolDef[]): PrivateFile => ({
  name: SERVER_TOOLS_FILE,
  contents: JSON.stringify(tools),
  mode: 0o600,
});

/** Reads a file's text; the MCP server's own is Node's. */
export type ReadText = (path: string) => string;

const readText: ReadText = (path) => readFileSync(path, 'utf8');

/**
 * The server tools the MCP server's environment names (`MWC_SERVER_TOOLS`: the file's path); none without it, or when
 * the file cannot be read or does not hold valid tools.
 */
export function serverToolsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  read: ReadText = readText,
): ServerToolDef[] {
  const path = env[SERVER_TOOLS_ENV];
  if (!path) return [];
  try {
    const parsed = ServerToolDefs.safeParse(JSON.parse(read(path)));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A server tool's `tools/list` entry: its words and schema as the server wrote them, its hints from `readOnly`. */
export function serverToolDefinition(tool: ServerToolDef) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      idempotentHint: tool.readOnly,
      openWorldHint: true,
    },
  };
}

/** True for a name a server tool may have (the bridge relays it; the server says whether the turn has it). */
export const isServerToolName = (name: string): boolean => ServerToolName.safeParse(name).success;

/** A call's input as relayed: an object, or why not (a missing input is an empty one). */
export function serverToolInput(
  tool: string,
  input: unknown,
):
  | { readonly ok: true; readonly input: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  if (input === undefined || input === null) return { ok: true, input: {} };
  if (typeof input === 'object' && !Array.isArray(input))
    return { ok: true, input: input as Record<string, unknown> };
  return { ok: false, error: `${tool} did nothing: its input must be an object of its arguments.` };
}
