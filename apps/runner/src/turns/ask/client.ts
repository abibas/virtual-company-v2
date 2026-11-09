import { connect } from 'node:net';
import type { AskQuestions } from '@mwc/shared/harness';
import { LineReader } from '../lines.ts';
import { ASK_LINE_MAX, AskReply } from './tool.ts';

/**
 * The MCP server's side of the turn's private socket (docs/harness.md, "Asking the person"): one connection per call,
 * one line out (`{token, questions}`), one line back (`{ok, text}` or `{ok: false, error}`). A socket that is not there
 * (the turn ended) or does not answer in time is said in words the agent can act on.
 */

/** How long a call waits for the runner. */
export const ASK_TIMEOUT_MS = 10_000;

export const NOT_IN_TURN =
  'The question was not shown: the chat turn that started this tool has ended or is not reachable.';

const failed = (error: string): AskReply => ({ ok: false, error });

/** Sends the questions to the runner at `socketPath` with `token`; never throws. */
export function askRunner(
  socketPath: string,
  token: string,
  questions: AskQuestions,
  timeoutMs = ASK_TIMEOUT_MS,
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
    const timer = setTimeout(() => finish(failed(`${NOT_IN_TURN} (no answer in time)`)), timeoutMs);
    let received = 0;
    socket.on('connect', () => socket.write(`${JSON.stringify({ token, questions })}\n`));
    socket.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const [line] = reader.push(chunk);
      if (line !== undefined) finish(readReply(line));
      else if (received > ASK_LINE_MAX) finish(failed(`${NOT_IN_TURN} (an answer too long)`));
    });
    socket.on('error', () => finish(failed(NOT_IN_TURN)));
    socket.on('close', () => finish(failed(NOT_IN_TURN)));
  });
}

/** The runner's answer line, or what was wrong with it. */
function readReply(line: string): AskReply {
  try {
    const reply = AskReply.safeParse(JSON.parse(line));
    if (reply.success) return reply.data;
  } catch {
    // Not JSON: said below.
  }
  return failed(`${NOT_IN_TURN} (an answer it could not read)`);
}
