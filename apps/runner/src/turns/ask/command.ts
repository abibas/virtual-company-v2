import { ASK_SOCKET_ENV, ASK_TOKEN_ENV } from '@mwc/harness-core';
import { LineReader } from '../lines.ts';
import { askRunner } from './client.ts';
import { type AskRelay, McpServer } from './mcp.ts';

/**
 * `runner.mjs mcp` (docs/harness.md, "Asking the person"): the runner's MCP server on stdio, as a harness starts it
 * for one turn, with the turn's socket and token in its environment. It reads one JSON-RPC message a line from stdin
 * and writes each answer as a line on stdout as soon as it is ready (nothing else goes there; JSON-RPC matches them by
 * id), until stdin ends and every answer is out; then it exits 0.
 * Without the socket's variables it still answers, and a call says it works only inside a chat turn.
 */

export const OUTSIDE_TURN =
  'The question was not shown: this tool works only inside a chat turn the runner started.';

/** The process the command runs on: its stdin as chunks, a line out, its environment, the runner's version. */
export interface McpIo {
  readonly input: AsyncIterable<Buffer | string>;
  write(line: string): void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly version: string;
}

/** The relay to the turn's runner from the environment; one that says why when the variables are missing. */
export function relayFrom(env: McpIo['env']): AskRelay {
  const socket = env[ASK_SOCKET_ENV];
  const token = env[ASK_TOKEN_ENV];
  if (!socket || !token) return () => Promise.resolve({ ok: false, error: OUTSIDE_TURN });
  return (questions) => askRunner(socket, token, questions);
}

/** Serves MCP on `io` until its input ends; resolves 0. */
export async function mcpCommand(io: McpIo): Promise<number> {
  const server = new McpServer({ version: io.version, ask: relayFrom(io.env) });
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
