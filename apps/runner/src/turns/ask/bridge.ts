import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import {
  ASK_SOCKET_ENV,
  ASK_TOKEN_ENV,
  type PrivateFile,
  TOOLS_ENV,
  type TurnTools,
} from '@mwc/harness-core';
import { AgentTool } from '@mwc/shared/flows';
import { ASK_TOOL, AskQuestions } from '@mwc/shared/harness';
import type { Log } from '../../system/log.ts';
import { LineReader } from '../lines.ts';
import { checkToolInput } from './agent-tools.ts';
import { ASK_LINE_MAX, ASK_SOCKET_FILE, type AskHandler, type AskReply, AskRequest } from './tool.ts';

/**
 * The runner's side of a turn's questions (docs/harness.md, "Asking the person"): a private folder per turn
 * (`<state>/turns/<12 hex>/`, 0700) holding a Unix socket (`ask.sock`) the turn's MCP server connects to, and the
 * files a driver asks for (Claude Code's `mcp.json`, 0600). A call must carry the turn's random token (compared in
 * constant time) and valid questions, or an agents' tool and a valid input (S6a); the handler the turn binds answers it,
 * a tool's call once the server said (the connection waits; only sending the request is timed). The socket listens
 * before the process starts (Node binds a path at once) and the folder goes, socket and files with it, when the process
 * ends. A runner that
 * takes a turn back after its restart (S5.4) listens on the same socket again (`reopen`), checking calls against the
 * token's SHA-256, which the turn's run folder keeps (never the token).
 */

/** The longest socket path (macOS's `sun_path` is 104 bytes with its end). */
export const SOCKET_PATH_MAX = 103;

/** How long a connection may stay without sending its request (the answer may take longer: a tool's server round trip). */
export const ASK_CONNECTION_MS = 10_000;

export const ASK_REFUSED = 'refused: wrong token';
export const NOT_READY = 'The turn is not ready for questions yet; try again.';

/** One turn's folder, socket and token. */
export interface AskBridge {
  readonly dir: string;
  readonly socketPath: string;
  /** The token the MCP server sends (a new bridge's; empty for a reopened one, which knows only its SHA-256). */
  readonly token: string;
  /** The token's SHA-256 (hex), for the run folder. */
  readonly tokenSha256: string;
  /** Who answers its calls; until then, each one is refused as not ready. */
  bind(handler: AskHandler): void;
  /** Writes a driver's file in the turn's folder with its mode. */
  write(file: PrivateFile): void;
  /** Stops listening and removes the folder with its socket and files; once. */
  close(): void;
  /** Stops listening and keeps the folder (the runner lets go of a turn that runs on; a later runner reopens it). */
  release(): void;
}

/** What a runner that offers its tools has: how a harness starts its MCP server, and each turn's bridge. */
export interface AskHost {
  /** `<node>`: the runner's own Node. */
  readonly command: string;
  /** `[<runner.mjs>, 'mcp']`. */
  readonly args: readonly string[];
  /** Opens a new turn's bridge; throws when its folder or socket cannot be made. */
  open(): AskBridge;
  /** Listens again on a re-attached turn's socket in `dir`, for the token whose SHA-256 is `tokenSha256` (S5.4). */
  reopen(dir: string, tokenSha256: string): AskBridge;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/** A token's SHA-256, hex. */
export const tokenDigest = (token: string) => digest(token).toString('hex');

/** The token, compared in constant time. */
export const sameToken = (given: string, token: string): boolean =>
  timingSafeEqual(digest(given), digest(token));

/** The answer to one request line, its token checked against `tokenSha256`: a question's at once, a tool's later. */
export function answerRequest(
  line: string,
  tokenSha256: string,
  handler: AskHandler | undefined,
  log: Log,
): AskReply | Promise<AskReply> {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    return { ok: false, error: 'not a request' };
  }
  const parsed = AskRequest.safeParse(request);
  if (!parsed.success) return { ok: false, error: 'not a request' };
  if (!timingSafeEqual(digest(parsed.data.token), Buffer.from(tokenSha256, 'hex'))) {
    log.warn('a question came with a wrong token; refused');
    return { ok: false, error: ASK_REFUSED };
  }
  if (parsed.data.tool !== undefined) return toolRequest(parsed.data, handler);
  const questions = AskQuestions.safeParse(parsed.data.questions);
  if (!questions.success) return { ok: false, error: 'The questions are not valid.' };
  return handler === undefined ? { ok: false, error: NOT_READY } : handler.ask(questions.data);
}

/** An agents' tool's call: a tool the runner knows, its input checked again, then the handler's (the server's) word. */
function toolRequest(request: AskRequest, handler: AskHandler | undefined): AskReply | Promise<AskReply> {
  const tool = AgentTool.safeParse(request.tool);
  if (!tool.success) return { ok: false, error: `Unknown tool: ${request.tool}` };
  const input = checkToolInput(tool.data, request.input);
  if (!input.ok) return input;
  return handler === undefined ? { ok: false, error: NOT_READY } : handler.tool(tool.data, input.input);
}

/**
 * Serves one connection: one request line, one answer line, then the end. Only the request is timed: once its line is
 * in, the answer may take as long as the handler takes (a tool waits for the server, which bounds it).
 */
function serve(socket: Socket, answer: (line: string) => AskReply | Promise<AskReply>): void {
  const reader = new LineReader();
  let received = 0;
  let answered = false;
  const reply = (value: AskReply) => {
    if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
  };
  socket.setTimeout(ASK_CONNECTION_MS, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: Buffer) => {
    if (answered) return;
    received += chunk.length;
    const [line] = reader.push(chunk);
    if (line === undefined && received <= ASK_LINE_MAX) return;
    answered = true;
    socket.setTimeout(0);
    if (line === undefined) reply({ ok: false, error: 'a request too long' });
    else void Promise.resolve(answer(line)).then(reply);
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
  return listenBridge(dir, token, tokenDigest(token), log);
}

/** Listens again on a turn's socket in `dir` (a stale socket file removed first), for the token of that SHA-256. */
export function reopenAskBridge(dir: string, tokenSha256: string, log: Log): AskBridge {
  rmSync(join(dir, ASK_SOCKET_FILE), { force: true });
  return listenBridge(dir, '', tokenSha256, log);
}

function listenBridge(dir: string, token: string, tokenSha256: string, log: Log): AskBridge {
  const socketPath = join(dir, ASK_SOCKET_FILE);
  let handler: AskHandler | undefined;
  const server = createServer((socket) =>
    serve(socket, (line) => answerRequest(line, tokenSha256, handler, log)),
  );
  server.on('error', (error) => log.warn('the question socket failed', { error: error.message }));
  server.listen(socketPath);
  let closed = false;
  return {
    dir,
    socketPath,
    token,
    tokenSha256,
    bind: (next) => {
      handler = next;
    },
    write: (file) => {
      const path = join(dir, file.name);
      writeFileSync(path, file.contents, { mode: file.mode });
      chmodSync(path, file.mode);
    },
    close: () => {
      if (!closed) server.close();
      closed = true;
      rmSync(dir, { recursive: true, force: true });
    },
    release: () => {
      if (!closed) server.close();
      closed = true;
    },
  };
}

/**
 * What a driver gets of a turn's bridge: its folder, how to start the MCP server, the socket and token for it, and the
 * agents' tools it offers (S6a: `MWC_TOOLS`, comma-joined, only when there are any), named after the question tool.
 */
export function turnTools(host: AskHost, bridge: AskBridge, tools: readonly AgentTool[] = []): TurnTools {
  return {
    dir: bridge.dir,
    command: host.command,
    args: host.args,
    env: {
      [ASK_SOCKET_ENV]: bridge.socketPath,
      [ASK_TOKEN_ENV]: bridge.token,
      ...(tools.length > 0 ? { [TOOLS_ENV]: tools.join(',') } : {}),
    },
    names: [ASK_TOOL, ...tools],
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
    reopen: (dir, tokenSha256) => reopenAskBridge(dir, tokenSha256, options.log),
  };
}
