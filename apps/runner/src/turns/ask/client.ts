import { connect } from 'node:net';
import type { AskQuestions } from '@mwc/shared/harness';
import { LineReader } from '../lines.ts';
import { ASK_LINE_MAX, AskReply } from './tool.ts';

/**
 * The MCP server's side of the turn's private socket (docs/harness.md, "Asking the person" and "Agents' tools"): one
 * connection per call, one line out (`{token, questions}`, or `{token, tool, input}` for an agents' tool, S6a), one
 * line back (`{ok, text}` or `{ok: false, error}`). A socket that is not there (the turn ended) or does not answer in
 * time is said in words the agent can act on.
 */

/** How long a question waits for the runner. */
export const ASK_TIMEOUT_MS = 10_000;

/** How long a tool's call waits for the runner, which waits for the server (`TOOL_REPLY_MS`) and answers before. */
export const TOOL_TIMEOUT_MS = 60_000;

export const NOT_IN_TURN =
  'The question was not shown: the chat turn that started this tool has ended or is not reachable.';

export const TOOL_NOT_IN_TURN =
  'The tool did nothing: the chat turn that started it has ended or is not reachable.';

const failed = (error: string): AskReply => ({ ok: false, error });

/** Sends one request line to the runner at `socketPath` and reads its answer; never throws. */
function request(
  socketPath: string,
  line: string,
  timeoutMs: number,
  unreachable: string,
): Promise<AskReply> {
  return new Promise((resolve) => {
    const reader = new LineReader();
    const socket = connect(socketPath);
    let done = false;
    const finish = (reply: AskReply) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(reply);
    };
    const timer = setTimeout(() => finish(failed(`${unreachable} (no answer in time)`)), timeoutMs);
    let received = 0;
    socket.on('connect', () => socket.write(`${line}\n`));
    socket.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const [answer] = reader.push(chunk);
      if (answer !== undefined) finish(readReply(answer, unreachable));
      else if (received > ASK_LINE_MAX) finish(failed(`${unreachable} (an answer too long)`));
    });
    socket.on('error', () => finish(failed(unreachable)));
    socket.on('close', () => finish(failed(unreachable)));
  });
}

/** Sends the questions to the runner at `socketPath` with `token`; never throws. */
export function askRunner(
  socketPath: string,
  token: string,
  questions: AskQuestions,
  timeoutMs = ASK_TIMEOUT_MS,
): Promise<AskReply> {
  return request(socketPath, JSON.stringify({ token, questions }), timeoutMs, NOT_IN_TURN);
}

/** Relays an agents' tool's (S6a) or a server tool's (S7.1c) call to the runner at `socketPath`; never throws. */
export function callRunner(
  socketPath: string,
  token: string,
  call: { readonly tool: string; readonly input: Record<string, unknown> },
  timeoutMs = TOOL_TIMEOUT_MS,
): Promise<AskReply> {
  return request(socketPath, JSON.stringify({ token, ...call }), timeoutMs, TOOL_NOT_IN_TURN);
}

/** The runner's answer line, or what was wrong with it. */
function readReply(line: string, unreachable: string): AskReply {
  try {
    const reply = AskReply.safeParse(JSON.parse(line));
    if (reply.success) return reply.data;
  } catch {
    // Not JSON: said below.
  }
  return failed(`${unreachable} (an answer it could not read)`);
}
