import type {
  CmdAck,
  FsList,
  FsMkdir,
  FsMkdirp,
  FsResult,
  PowerCommand,
  PowerResult,
  RunnerCaps,
  RunnerUpdate,
  RunnerUpdateResult,
  ServerFrame,
  ToolsCheck,
  ToolsInstall,
  ToolsResult,
} from '@mwc/shared/runner-protocol';
import type { RunnerCredential } from '../../../../../platform/auth/api-keys.ts';
import type { SocketHandlers, SocketLink } from '../../../../../platform/realtime/sockets.ts';
import type { TerminalChannel, TerminalRequest, TerminalSink } from './terminals.ts';
import type { HubTunnels } from './tunnels.ts';
import type { TurnAdopter, TurnChannel, TurnRequest, TurnSink } from './turn-types.ts';

/**
 * A server frame that is a command (it has a `cmdId`), and what answers it (a runner older than `runner.update`, the
 * folder frames or the tools frames acks them as commands it does not know).
 */
export type CommandFrame = Extract<ServerFrame, { cmdId: string }>;
export type ReplyTo<F extends CommandFrame> = F extends PowerCommand
  ? PowerResult
  : F extends RunnerUpdate
    ? RunnerUpdateResult | CmdAck
    : F extends FsList | FsMkdir | FsMkdirp
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
  /** How long a turn whose runner went away waits for it (S5.4; `TURN_REATTACH_GRACE_MS`, 30 minutes). */
  readonly turnGraceMs?: number;
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
  /** Who builds the sink of a running turn a restarted server takes back from its runner (the chats module, S5.4). */
  adoptTurns(adopter: TurnAdopter): void;
  /** The machine's live work: its chat turns running (or waiting for their runner) and its terminals open. */
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
