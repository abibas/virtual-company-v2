import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { ASK_SOCKET_ENV, ASK_TOKEN_ENV, type PrivateFile, type TurnTools } from '@mwc/harness-core';
import { AskQuestions } from '@mwc/shared/harness';
import type { Log } from '../../system/log.ts';
import { LineReader } from '../lines.ts';
import { ASK_LINE_MAX, ASK_SOCKET_FILE, type AskHandler, type AskReply, AskRequest } from './tool.ts';

/**
 * The runner's side of a turn's questions (docs/harness.md, "Asking the person"): a private folder per turn
 * (`<state>/turns/<12 hex>/`, 0700) holding a Unix socket (`ask.sock`) the turn's MCP server connects to, and the
 * files a driver asks for (Claude Code's `mcp.json`, 0600). A call must carry the turn's random token (compared in
 * constant time) and valid questions; the handler the turn binds answers it. The socket listens before the process
 * starts (Node binds a path at once) and the folder goes, socket and files with it, when the process ends.
 */

/** The longest socket path (macOS's `sun_path` is 104 bytes with its end). */
export const SOCKET_PATH_MAX = 103;

/** How long a connection may stay without sending its request. */
export const ASK_CONNECTION_MS = 10_000;

export const ASK_REFUSED = 'refused: wrong token';
export const NOT_READY = 'The turn is not ready for questions yet; try again.';

/** One turn's folder, socket and token. */
export interface AskBridge {
  readonly dir: string;
  readonly socketPath: string;
  readonly token: string;
  /** Who answers its calls; until then, each one is refused as not ready. */
  bind(handler: AskHandler): void;
  /** Writes a driver's file in the turn's folder with its mode. */
  write(file: PrivateFile): void;
  /** Stops listening and removes the folder with its socket and files; once. */
  close(): void;
}

/** What a runner that offers its tools has: how a harness starts its MCP server, and each turn's bridge. */
export interface AskHost {
  /** `<node>`: the runner's own Node. */
  readonly command: string;
  /** `[<runner.mjs>, 'mcp']`. */
  readonly args: readonly string[];
  /** Opens a new turn's bridge; throws when its folder or socket cannot be made. */
  open(): AskBridge;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/** The token, compared in constant time. */
export const sameToken = (given: string, token: string): boolean =>
  timingSafeEqual(digest(given), digest(token));

/** The answer to one request line. */
export function answerRequest(
  line: string,
  token: string,
  handler: AskHandler | undefined,
  log: Log,
): AskReply {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    return { ok: false, error: 'not a request' };
  }
  const parsed = AskRequest.safeParse(request);
  if (!parsed.success) return { ok: false, error: 'not a request' };
  if (!sameToken(parsed.data.token, token)) {
    log.warn('a question came with a wrong token; refused');
    return { ok: false, error: ASK_REFUSED };
  }
  const questions = AskQuestions.safeParse(parsed.data.questions);
  if (!questions.success) return { ok: false, error: 'The questions are not valid.' };
  return handler === undefined ? { ok: false, error: NOT_READY } : handler(questions.data);
}

/** Serves one connection: one request line, one answer line, then the end. */
function serve(socket: Socket, answer: (line: string) => AskReply): void {
  const reader = new LineReader();
  let received = 0;
  let answered = false;
  const reply = (value: AskReply) => {
    answered = true;
    socket.end(`${JSON.stringify(value)}\n`);
  };
  socket.setTimeout(ASK_CONNECTION_MS, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: Buffer) => {
    if (answered) return;
    received += chunk.length;
    const [line] = reader.push(chunk);
    if (line !== undefined) reply(answer(line));
    else if (received > ASK_LINE_MAX) reply({ ok: false, error: 'a request too long' });
  });
}

/** Opens a turn's bridge under `root` (see above). */
export function openAskBridge(root: string, log: Log): AskBridge {
  const dir = join(root, randomBytes(6).toString('hex'));
  const socketPath = join(dir, ASK_SOCKET_FILE);
  if (Buffer.byteLength(socketPath) > SOCKET_PATH_MAX) {
    throw new Error(`the socket path would be longer than ${SOCKET_PATH_MAX} bytes: ${socketPath}`);
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  const token = randomBytes(32).toString('hex');
  let handler: AskHandler | undefined;
  const server = createServer((socket) => serve(socket, (line) => answerRequest(line, token, handler, log)));
  server.on('error', (error) => log.warn('the question socket failed', { error: error.message }));
  server.listen(socketPath);
  let closed = false;
  return {
    dir,
    socketPath,
    token,
    bind: (next) => {
      handler = next;
    },
    write: (file) => {
      const path = join(dir, file.name);
      writeFileSync(path, file.contents, { mode: file.mode });
      chmodSync(path, file.mode);
    },
    close: () => {
      if (closed) return;
      closed = true;
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What a driver gets of a turn's bridge: its folder, how to start the MCP server, and the socket and token for it. */
export function turnTools(host: AskHost, bridge: AskBridge): TurnTools {
  return {
    dir: bridge.dir,
    command: host.command,
    args: host.args,
    env: { [ASK_SOCKET_ENV]: bridge.socketPath, [ASK_TOKEN_ENV]: bridge.token },
  };
}

/** The runner's tools on this machine: its MCP server started as `command args`, a bridge per turn under `root`. */
export function askHost(options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly root: string;
  readonly log: Log;
}): AskHost {
  return {
    command: options.command,
    args: options.args,
    open: () => openAskBridge(options.root, options.log),
  };
}
