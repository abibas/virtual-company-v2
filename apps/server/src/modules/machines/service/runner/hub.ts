import { type DbHandle, tenant } from '@mwc/db';
import {
  encodeFrame,
  type HeldTurn,
  RUNNER_HELLO_TIMEOUT_MS,
  RUNNER_PING_MS,
  type RunnerHello,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { machinesRepo } from '../../repo.ts';
import { MIN_RUNNER_VERSION } from '../../rules.ts';
import { type ConnectionContext, HubError, RunnerConnection } from './connection.ts';
import { closeAll, connections, GOING_AWAY, machineQueues } from './hub/sockets.ts';
import { terminalBoard } from './hub/terminals.ts';
import { tunnelBoard } from './hub/tunnels.ts';
import { turnBoard } from './hub/turns.ts';
import type { ConnectedRunner, HubOptions, ReplyTo, RunnerHub } from './hub/types.ts';

export { HubError, type HubErrorCode } from './connection.ts';
export type { TerminalChannel, TerminalEnding, TerminalRequest, TerminalSink } from './hub/terminals.ts';
export type {
  CollectedArtifact,
  TurnAdopter,
  TurnAsked,
  TurnChannel,
  TurnCollected,
  TurnEnding,
  TurnRequest,
  TurnSink,
  TurnToolCall,
  TurnToolReply,
} from './hub/turns.ts';
export type { CommandFrame, ConnectedRunner, HubOptions, ReplyTo, RunnerHub } from './hub/types.ts';

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

/** A machine's name, for the words of a turn whose runner went away for good; undefined once it is gone. */
async function machineName(db: DbHandle, companyId: string, machineId: string): Promise<string | undefined> {
  return (await machinesRepo().get(await tenant(db, companyId), machineId))?.name;
}

/** What the hub keeps: its sockets, write queues, connect listeners and the boards of tunnels, terminals and turns. */
function hubParts(deps: HubDeps, options: HubOptions) {
  const sockets = connections();
  const turnOptions = options.turnGraceMs === undefined ? {} : { graceMs: options.turnGraceMs };
  return {
    sockets,
    queues: machineQueues(deps.logger),
    listeners: connectListeners(deps.logger),
    tunnels: tunnelBoard(deps.clock, sockets.ready),
    terminals: terminalBoard(),
    turns: turnBoard({
      ...turnOptions,
      logger: deps.logger,
      machineName: (companyId, machineId) => machineName(deps.db, companyId, machineId),
    }),
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
    resume: (connection: RunnerConnection, held: readonly HeldTurn[]) => turns.resume(connection, held),
  };
  return ctx;
}

/** The hub on the server's database, logger and clock. */
export function createRunnerHub(deps: HubDeps, options: HubOptions = {}): RunnerHub {
  const parts = hubParts(deps, options);
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
    adoptTurns: (adopter) => turns.adopt(adopter),
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
      turns.close();
      return closeAll(sockets.all, options.closeTimeoutMs ?? 2000, queues.idle);
    },
  };
}
