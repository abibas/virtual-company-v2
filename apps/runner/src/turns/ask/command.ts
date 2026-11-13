import { ASK_SOCKET_ENV, ASK_TOKEN_ENV } from '@mwc/harness-core';
import { LineReader } from '../lines.ts';
import { toolsFromEnv } from './agent-tools.ts';
import { askRunner, callRunner } from './client.ts';
import { type AskRelay, McpServer, type ToolRelay } from './mcp.ts';
import { type ReadText, serverToolsFromEnv } from './server-tools.ts';

/**
 * `runner.mjs mcp` (docs/harness.md, "Asking the person"): the runner's MCP server on stdio, as a harness starts it
 * for one turn, with the turn's socket and token in its environment. It reads one JSON-RPC message a line from stdin
 * and writes each answer as a line on stdout as soon as it is ready (nothing else goes there; JSON-RPC matches them by
 * id), until stdin ends and every answer is out; then it exits 0.
 * Without the socket's variables it still answers, and a call says it works only inside a chat turn. The agents' tools it
 * offers (S6a) are the ones `MWC_TOOLS` names, the server's own (S7.1c) the ones in the file `MWC_SERVER_TOOLS` names.
 */

export const OUTSIDE_TURN =
  'The question was not shown: this tool works only inside a chat turn the runner started.';

export const TOOL_OUTSIDE_TURN = 'The tool did nothing: it works only inside a chat turn the runner started.';

/** The process the command runs on: its stdin as chunks, a line out, its environment, the runner's version. */
export interface McpIo {
  readonly input: AsyncIterable<Buffer | string>;
  write(line: string): void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly version: string;
  /** Reads the server tools' file; Node's when left out. */
  readonly read?: ReadText;
}

/** The relays to the turn's runner from the environment; ones that say why when the variables are missing. */
export function relayFrom(env: McpIo['env']): { readonly ask: AskRelay; readonly call: ToolRelay } {
  const socket = env[ASK_SOCKET_ENV];
  const token = env[ASK_TOKEN_ENV];
  if (!socket || !token) {
    return {
      ask: () => Promise.resolve({ ok: false, error: OUTSIDE_TURN }),
      call: () => Promise.resolve({ ok: false, error: TOOL_OUTSIDE_TURN }),
    };
  }
  return {
    ask: (questions) => askRunner(socket, token, questions),
    call: (call) => callRunner(socket, token, call),
  };
}

/** Serves MCP on `io` until its input ends; resolves 0. */
export async function mcpCommand(io: McpIo): Promise<number> {
  const server = new McpServer({
    version: io.version,
    ...relayFrom(io.env),
    tools: toolsFromEnv(io.env),
    serverTools: serverToolsFromEnv(io.env, io.read),
  });
  const reader = new LineReader();
  const pending: Promise<void>[] = [];
  const take = (line: string) => {
    if (line.trim() === '') return;
    pending.push(
      server.line(line).then((text) => {
        if (text !== undefined) io.write(`${text}\n`);
      }),
    );
  };
  for await (const chunk of io.input) for (const line of reader.push(chunk)) take(line);
  const last = reader.end();
  if (last !== undefined) take(last);
  await Promise.all(pending);
  return 0;
}

/** The real process's stdin, stdout and environment. */
export function nodeMcpIo(version: string): McpIo {
  return {
    input: process.stdin,
    write: (line) => {
      process.stdout.write(line);
    },
    env: process.env,
    version,
  };
}
