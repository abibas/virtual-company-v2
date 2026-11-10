import type { DbHandle } from '@mwc/db';
import {
  type CmdAck,
  encodeFrame,
  type FsList,
  type FsMkdir,
  type FsResult,
  type PowerCommand,
  type PowerResult,
  RUNNER_HELLO_TIMEOUT_MS,
  RUNNER_PING_MS,
  type RunnerCaps,
  type RunnerHello,
  type RunnerUpdate,
  type RunnerUpdateResult,
  type ServerFrame,
  type ToolsCheck,
  type ToolsInstall,
  type ToolsResult,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerCredential } from '../../../../platform/auth/api-keys.ts';
import type { SocketHandlers, SocketLink } from '../../../../platform/realtime/sockets.ts';
import { MIN_RUNNER_VERSION } from '../../rules.ts';
import { type ConnectionContext, HubError, RunnerConnection } from './connection.ts';
import { closeAll, connections, GOING_AWAY, machineQueues } from './hub/sockets.ts';
import {
  type TerminalChannel,
  type TerminalRequest,
  type TerminalSink,
  terminalBoard,
} from './hub/terminals.ts';
import { type HubTunnels, tunnelBoard } from './hub/tunnels.ts';
import { type TurnChannel, type TurnRequest, type TurnSink, turnBoard } from './hub/turns.ts';

export { HubError, type HubErrorCode } from './connection.ts';
export type { TerminalChannel, TerminalEnding, TerminalRequest, TerminalSink } from './hub/terminals.ts';
export type { TurnAsked, TurnChannel, TurnEnding, TurnRequest, TurnSink } from './hub/turns.ts';

/**
 * A server frame that is a command (it has a `cmdId`), and what answers it (a runner older than `runner.update`, the
 * folder frames or the tools frames acks them as commands it does not know).
 */
export type CommandFrame = Extract<ServerFrame, { cmdId: string }>;
export type ReplyTo<F extends CommandFrame> = F extends PowerCommand
  ? PowerResult
  : F extends RunnerUpdate
    ? RunnerUpdateResult | CmdAck
    : F extends FsList | FsMkdir
      ? FsResult | CmdAck
      : F extends ToolsCheck | ToolsInstall
        ? ToolsResult | CmdAck
        : CmdAck;

/** A machine's runner as the hub knows it, once it answered `server.hello`. */
export interface ConnectedRunner {
  readonly companyId: string;
  readonly machineId: string;
  readonly version: string;
  /** When its bundle was built (UTC, ISO 8601); null from its sources or from a runner older than versioned runners. */
  readonly builtAt: string | null;
  /** The build it runs (its bundle's SHA-256); null from its sources or when its hello did not say. */
  readonly build: string | null;
  readonly caps: RunnerCaps;
  readonly connectedAt: Date;
}

export interface HubOptions {
  /** How long a new socket has to say `runner.hello` (10 s). */
  readonly helloTimeoutMs?: number;
  /** The lowest runner version taken (`MIN_RUNNER_VERSION`). */
  readonly minRunnerVersion?: string;
  /** How long `request` waits for an answer unless told otherwise (30 s). */
  readonly requestTimeoutMs?: number;
  /** How often each socket is pinged (20 s). */
  readonly pingMs?: number;
  /** How long `close` waits for the sockets' close handshakes before it cuts them (2 s). */
  readonly closeTimeoutMs?: number;
}

/**
 * The runner hub (S4.2): every runner socket of this server process, by machine. S4.4b's power control, the terminals,
 * S5.1b's chat turns and S5's runs talk to runners only through it. Commands go only to a runner that answered
 * `server.hello` on this process.
 */
export interface RunnerHub {
  readonly pingMs: number;
  /** The power controllers' tunnels: each one's set (sent only when changed) and the states they report (memory). */
  readonly tunnels: HubTunnels;
  /** True while the machine's runner is connected to this process and past its hello. */
  isOnline(machineId: string): boolean;
  /** The machine's connected runner (its version, caps as its last hello or `runner.caps` said, since when), or undefined. */
  connected(machineId: string): ConnectedRunner | undefined;
  /** Sends a frame to the machine's runner; false when it is not connected. */
  send(machineId: string, frame: ServerFrame): boolean;
  /**
   * Sends a command and resolves with its answer, matched by `cmdId`: `power.result` for `power.command`, `fs.result`
   * for the folder frames, `tools.result` for the tools frames, `cmd.ack` for the others; `output` gets each
   * `tools.output` line of the command meanwhile. Rejects with a `HubError`: `offline` (not connected), `timeout`,
   * `disconnected` (closed first).
   */
  request<F extends CommandFrame>(
    machineId: string,
    frame: F,
    options?: { readonly timeoutMs?: number; readonly output?: (line: string) => void },
  ): Promise<ReplyTo<F>>;
  /**
   * Opens a terminal on the machine's runner (`terminal.open`) and relays its frames to `sink` until it ends; undefined
   * when the runner is not ready or has no terminal (`caps.terminal`).
   */
  terminal(machineId: string, request: TerminalRequest, sink: TerminalSink): TerminalChannel | undefined;
  /**
   * Starts a chat turn on the machine's runner (`turn.start`) and hands its frames to `sink` until it ends (S5.1b);
   * undefined when the runner is not ready. The caller checks the runner has the harness (`caps.harnesses`).
   */
  turn(machineId: string, request: TurnRequest, sink: TurnSink): TurnChannel | undefined;
  /** The machine's live work: its chat turns running and its terminals open (the machine's and the chats'). */
  live(machineId: string): { readonly turns: number; readonly terminals: number };
  /** Closes every socket of the machine with `code`; false when it has none. */
  disconnect(machineId: string, code: number, reason: string): boolean;
  /**
   * Calls `listener` each time a runner is ready (it answered `server.hello`; the power code sends it its hold);
   * returns the unsubscribe. A listener that throws is logged, never the connection's problem.
   */
  onConnect(listener: (runner: ConnectedRunner) => void): () => void;
  /** A new socket of an authenticated runner (the socket route calls it). */
  open(link: SocketLink, runner: RunnerCredential): SocketHandlers;
  /** Resolves once every write queued so far is done. */
  idle(): Promise<void>;
  /** Closes every socket (1001, cut after the close timeout) and waits for their writes: the server's shutdown. */
  close(): Promise<void>;
}

/** A ready connection as the hub shows it. */
function runnerOf(connection: RunnerConnection): ConnectedRunner {
  const { version, builtAt, caps, build } = connection.hello as RunnerHello;
  const { machineId, runner } = connection;
  const connectedAt = connection.readyAt as Date;
  return {
    companyId: runner.companyId,
    machineId,
    version,
    builtAt: builtAt ?? null,
    build: build ?? null,
    caps,
    connectedAt,
  };
}

/** The connect listeners, each called in turn; one that throws is logged. */
function connectListeners(logger: Logger) {
  const listeners = new Set<(runner: ConnectedRunner) => void>();
  return {
    add(listener: (runner: ConnectedRunner) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready(connection: RunnerConnection): void {
      const runner = runnerOf(connection);
      for (const listener of listeners) {
        try {
          listener(runner);
        } catch (error) {
          logger.error({ err: error, machineId: runner.machineId }, 'runner hub: a connect listener failed');
        }
      }
    },
  };
}

type HubDeps = { readonly db: DbHandle; readonly logger: Logger; readonly clock: () => Date };

/** What the hub keeps: its sockets, write queues, connect listeners and the boards of tunnels, terminals and turns. */
function hubParts(deps: HubDeps) {
  const sockets = connections();
  return {
    sockets,
    queues: machineQueues(deps.logger),
    listeners: connectListeners(deps.logger),
    tunnels: tunnelBoard(deps.clock, sockets.ready),
    terminals: terminalBoard(),
    turns: turnBoard(),
  };
}

/** What each connection gets from the hub: its parts' callbacks (a closed one drops its terminals and turns). */
function connectionContext(deps: HubDeps, options: HubOptions, parts: ReturnType<typeof hubParts>) {
  const { sockets, queues, listeners, tunnels, terminals, turns } = parts;
  const ctx: ConnectionContext = {
    ...deps,
    helloTimeoutMs: options.helloTimeoutMs ?? RUNNER_HELLO_TIMEOUT_MS,
    minRunnerVersion: options.minRunnerVersion ?? MIN_RUNNER_VERSION,
    enqueue: queues.enqueue,
    claim: sockets.claim,
    ready: listeners.ready,
    release: (connection) => {
      terminals.drop(connection);
      turns.drop(connection);
      return sockets.release(connection);
    },
    tunnel: tunnels.record,
    terminal: terminals.record,
    turn: turns.record,
  };
  return ctx;
}

/** The hub on the server's database, logger and clock. */
export function createRunnerHub(deps: HubDeps, options: HubOptions = {}): RunnerHub {
  const parts = hubParts(deps);
  const { sockets, queues, listeners, tunnels, terminals, turns } = parts;
  const ctx = connectionContext(deps, options, parts);
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  let closing = false;
  return {
    pingMs: options.pingMs ?? RUNNER_PING_MS,
    tunnels: tunnels.api,
    isOnline: (machineId) => sockets.ready(machineId) !== undefined,
    connected(machineId) {
      const connection = sockets.ready(machineId);
      return connection === undefined ? undefined : runnerOf(connection);
    },
    onConnect: listeners.add,
    send(machineId, frame) {
      const connection = sockets.ready(machineId);
      connection?.link.send(encodeFrame(frame));
      return connection !== undefined;
    },
    async request(machineId, frame, requestOptions) {
      const connection = sockets.ready(machineId);
      if (connection === undefined) throw new HubError('offline', machineId, 'The runner is not connected');
      const timeoutMs = requestOptions?.timeoutMs ?? requestTimeoutMs;
      const reply = await connection.request(frame, timeoutMs, requestOptions?.output);
      return reply as ReplyTo<typeof frame>;
    },
    terminal(machineId, request, sink) {
      const connection = sockets.ready(machineId);
      if (connection?.hello?.caps.terminal !== true) return undefined;
      return terminals.open(connection, request, sink);
    },
    turn(machineId, request, sink) {
      const connection = sockets.ready(machineId);
      return connection === undefined ? undefined : turns.start(connection, request, sink);
    },
    live: (machineId) => ({ turns: turns.count(machineId), terminals: terminals.count(machineId) }),
    disconnect(machineId, code, reason) {
      const ofMachine = [...sockets.all].filter((connection) => connection.machineId === machineId);
      for (const connection of ofMachine) connection.link.close(code, reason);
      return ofMachine.length > 0;
    },
    open(link, runner) {
      const connection = new RunnerConnection(ctx, link, runner);
      sockets.all.add(connection);
      if (closing) link.close(GOING_AWAY, 'The server is shutting down');
      return { message: (text) => connection.message(text), closed: (code) => connection.closed(code) };
    },
    idle: queues.idle,
    close() {
      closing = true;
      return closeAll(sockets.all, options.closeTimeoutMs ?? 2000, queues.idle);
    },
  };
}
