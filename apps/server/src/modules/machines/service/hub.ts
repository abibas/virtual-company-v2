import type { DbHandle } from '@mwc/db';
import {
  type CmdAck,
  encodeFrame,
  type PowerCommand,
  type PowerResult,
  RUNNER_HELLO_TIMEOUT_MS,
  RUNNER_PING_MS,
  type RunnerCaps,
  type RunnerHello,
  type ServerFrame,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerCredential } from '../../../platform/auth/api-keys.ts';
import type { SocketHandlers, SocketLink } from '../../../platform/realtime/sockets.ts';
import { MIN_RUNNER_VERSION } from '../rules.ts';
import { type ConnectionContext, HubError, RunnerConnection } from './connection.ts';

export { HubError, type HubErrorCode } from './connection.ts';

/** A server frame that is a command (it has a `cmdId`), and what answers it. */
export type CommandFrame = Extract<ServerFrame, { cmdId: string }>;
export type ReplyTo<F extends CommandFrame> = F extends PowerCommand ? PowerResult : CmdAck;

/** A machine's runner as the hub knows it, once it answered `server.hello`. */
export interface ConnectedRunner {
  readonly companyId: string;
  readonly machineId: string;
  readonly version: string;
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
 * The runner hub (S4.2): every runner socket of this server process, by machine. S4.4b's power control and S5's runs
 * talk to runners only through it. Commands go only to a runner that answered `server.hello` on this process.
 */
export interface RunnerHub {
  readonly pingMs: number;
  /** True while the machine's runner is connected to this process and past its hello. */
  isOnline(machineId: string): boolean;
  /** The machine's connected runner (its version, caps, since when), or undefined. */
  connected(machineId: string): ConnectedRunner | undefined;
  /** Sends a frame to the machine's runner; false when it is not connected. */
  send(machineId: string, frame: ServerFrame): boolean;
  /**
   * Sends a command and resolves with its answer, matched by `cmdId`: `power.result` for `power.command`, `cmd.ack`
   * for the others. Rejects with a `HubError`: `offline` (not connected), `timeout`, `disconnected` (closed first).
   */
  request<F extends CommandFrame>(
    machineId: string,
    frame: F,
    options?: { readonly timeoutMs?: number },
  ): Promise<ReplyTo<F>>;
  /** Closes every socket of the machine with `code`; false when it has none. */
  disconnect(machineId: string, code: number, reason: string): boolean;
  /** A new socket of an authenticated runner (the socket route calls it). */
  open(link: SocketLink, runner: RunnerCredential): SocketHandlers;
  /** Resolves once every write queued so far is done. */
  idle(): Promise<void>;
  /** Closes every socket (1001, cut after the close timeout) and waits for their writes: the server's shutdown. */
  close(): Promise<void>;
}

const GOING_AWAY = 1001;

/** One promise chain per machine, so a machine's writes run in the order its frames came. */
function machineQueues(logger: Logger) {
  const queues = new Map<string, Promise<void>>();
  return {
    enqueue(machineId: string, work: () => Promise<void>): void {
      const next = (queues.get(machineId) ?? Promise.resolve()).then(work).catch((error: unknown) => {
        logger.error({ err: error, machineId }, 'runner hub: queued work failed');
      });
      queues.set(machineId, next);
      void next.then(() => {
        if (queues.get(machineId) === next) queues.delete(machineId);
      });
    },
    async idle(): Promise<void> {
      while (queues.size > 0) await Promise.all(queues.values());
    },
  };
}

/** The hub's sockets: every one, and each machine's current one (the one that said hello last). */
function connections() {
  const current = new Map<string, RunnerConnection>();
  const all = new Set<RunnerConnection>();
  return {
    all,
    /** Makes it its machine's current connection, closing the one it replaces with 4004. */
    claim(connection: RunnerConnection): void {
      const previous = current.get(connection.machineId);
      if (previous !== undefined) {
        previous.replaced = true;
        previous.link.close(4004, 'A newer connection of this machine took over');
      }
      current.set(connection.machineId, connection);
    },
    /** Forgets it; true when it was its machine's current connection. */
    release(connection: RunnerConnection): boolean {
      all.delete(connection);
      if (current.get(connection.machineId) !== connection) return false;
      current.delete(connection.machineId);
      return true;
    },
    /** The machine's current connection once it answered `server.hello`. */
    ready(machineId: string): RunnerConnection | undefined {
      const connection = current.get(machineId);
      return connection?.readyAt === undefined ? undefined : connection;
    },
  };
}

/** Closes every socket with 1001, waits for their closes (cutting the ones still open after `timeoutMs`), then writes. */
async function closeAll(all: ReadonlySet<RunnerConnection>, timeoutMs: number, idle: () => Promise<void>) {
  const open = [...all];
  for (const connection of open) connection.link.close(GOING_AWAY, 'The server is shutting down');
  const closed = Promise.all(open.map((connection) => connection.done));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  if ((await Promise.race([closed, timeout])) === 'timeout') {
    for (const connection of all) connection.link.terminate();
    await closed;
  }
  clearTimeout(timer);
  await idle();
}

/** The hub on the server's database, logger and clock. */
export function createRunnerHub(
  deps: { readonly db: DbHandle; readonly logger: Logger; readonly clock: () => Date },
  options: HubOptions = {},
): RunnerHub {
  const sockets = connections();
  const queues = machineQueues(deps.logger);
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  let closing = false;
  const ctx: ConnectionContext = {
    ...deps,
    helloTimeoutMs: options.helloTimeoutMs ?? RUNNER_HELLO_TIMEOUT_MS,
    minRunnerVersion: options.minRunnerVersion ?? MIN_RUNNER_VERSION,
    enqueue: queues.enqueue,
    claim: sockets.claim,
    release: sockets.release,
  };
  return {
    pingMs: options.pingMs ?? RUNNER_PING_MS,
    isOnline: (machineId) => sockets.ready(machineId) !== undefined,
    connected(machineId) {
      const connection = sockets.ready(machineId);
      if (connection === undefined) return undefined;
      const { version, caps } = connection.hello as RunnerHello;
      const connectedAt = connection.readyAt as Date;
      return { companyId: connection.runner.companyId, machineId, version, caps, connectedAt };
    },
    send(machineId, frame) {
      const connection = sockets.ready(machineId);
      connection?.link.send(encodeFrame(frame));
      return connection !== undefined;
    },
    async request(machineId, frame, requestOptions) {
      const connection = sockets.ready(machineId);
      if (connection === undefined) throw new HubError('offline', machineId, 'The runner is not connected');
      const reply = await connection.request(frame, requestOptions?.timeoutMs ?? requestTimeoutMs);
      return reply as ReplyTo<typeof frame>;
    },
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
