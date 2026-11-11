import type { TurnSpec } from '@mwc/shared/harness';
import {
  encodeFrame,
  type HeldTurn,
  type ResumedTurn,
  type ServerFrame,
  TURN_REATTACH_GRACE_MS,
  type TurnArtifacts,
  type TurnEnd,
  type TurnEventItem,
  type TurnQuestion,
  type TurnRunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerConnection } from '../connection.ts';
import { type ArtifactAssembler, artifactAssembler, type CollectedArtifact } from './artifacts.ts';
import { type TurnToolCall, type TurnToolReply, toolCalls } from './tools.ts';

export type { CollectedArtifact } from './artifacts.ts';
export type { TurnToolCall, TurnToolReply } from './tools.ts';

/**
 * The hub's chat turns (S5.1b, docs/runner-protocol.md "Chat turns"; S5.4, "Surviving restarts"): each turn by its id,
 * with the sink its frames go to (the chats module, which stores them) and the runner connection carrying it. A turn
 * outlives its connection when its runner keeps turns (`caps.reattach`): when that socket closes the turn is detached
 * (its sink told) and waits `graceMs` for its machine's runner to say hello with it; a hello naming it binds it to the
 * new connection and answers `turn.resume` with the last event the sink stored, so the runner resends what follows. A
 * turn this process has no binding for (the server restarted) is asked of the chats module (`adopt`), which builds its
 * sink from the database. A hello that leaves out a detached turn of its machine, the grace running out, and the close
 * of an older runner's connection end the turn (`machine_disconnected`). A stop asked while detached goes once the
 * turn is bound again. Once a sink recorded a turn's end, the runner hears `turn.ack`. A task step's collected files
 * (S5.3b) are put together here (`artifacts.ts`) and handed to the sink whole, with what the runner left out. An agent's
 * tool call (S6a, `tools.ts`) goes to the sink and its answer back to the runner.
 */

/** A turn to start: the server's id and the spec with its credential. */
export interface TurnRequest {
  readonly turnId: string;
  readonly spec: TurnSpec;
}

/** How a turn ended: `turn.end` without its type and turn id. */
export type TurnEnding = Omit<TurnEnd, 'type' | 'turnId'>;

/** A question the agent asked (S5.2): `turn.question` without its type and turn id. */
export type TurnAsked = Omit<TurnQuestion, 'type' | 'turnId'>;

/** What the runner collected and left out of a task step's outputs (S5.3b): `turn.artifacts` without its type. */
export type TurnCollected = Omit<TurnArtifacts, 'type' | 'turnId'>;

/** Where a turn's frames go, in the order the runner sent them. */
export interface TurnSink {
  events(items: readonly TurnEventItem[]): void;
  /** The agent asked the person, between the events numbered before and after `seq`. */
  question(asked: TurnAsked): void;
  /** A collected file, put together and checked (S5.3b); before the end. */
  artifact?(file: CollectedArtifact): void;
  /** What the runner collected and left out (S5.3b); after the last file, before the end. */
  artifacts?(collected: TurnCollected): void;
  /** An agent's tool call (S6a): the answer the tool returns. */
  tool?(call: TurnToolCall): Promise<TurnToolReply>;
  /** The end; nothing follows it. Resolves once it is recorded (then the runner hears `turn.ack`). */
  end(ending: TurnEnding): void | Promise<void>;
  /** The highest event number stored so far, once what came before is stored (S5.4). */
  lastSeq?(): Promise<number>;
  /** Its runner went away (true: it waits for it) or came back with it (false) (S5.4). */
  detached?(away: boolean): void;
  /** A turn taken back after a server restart: its channel, for a stop or a message. */
  adopted?(channel: TurnChannel): void;
}

/** One started turn, as its starter drives it. Nothing is sent once it ended. */
export interface TurnChannel {
  readonly turnId: string;
  /** Gives it the person's message (`turn.input`, S5.2 step 6); its echo comes back as an `input` event, or nothing. */
  input(inputId: string, text: string): void;
  /** Asks the runner to stop it (`turn.stop`); its `turn.end` follows (while detached, once its runner is back). */
  stop(): void;
}

/** Builds the sink of a running turn this process does not hold (after a restart); undefined when there is none. */
export type TurnAdopter = (
  runner: { readonly companyId: string; readonly machineId: string },
  turnId: string,
) => Promise<TurnSink | undefined>;

/** The end of a turn whose runner went away for good. */
export const TURN_DISCONNECTED: TurnEnding = { ok: false, exitCode: null, error: 'machine_disconnected' };

/** What a `turn.end` says, without its unknown fields. */
function endingOf(frame: TurnEnd): TurnEnding {
  return {
    ok: frame.ok,
    exitCode: frame.exitCode,
    ...(frame.error === undefined ? {} : { error: frame.error }),
    ...(frame.authJson === undefined ? {} : { authJson: frame.authJson }),
  };
}

interface Binding {
  readonly turnId: string;
  readonly machineId: string;
  readonly sink: TurnSink;
  connection: RunnerConnection | undefined;
  grace: ReturnType<typeof setTimeout> | undefined;
  stopWanted: boolean;
}

const send = (connection: RunnerConnection, frame: ServerFrame) => connection.link.send(encodeFrame(frame));

export function turnBoard(options: { readonly graceMs?: number; readonly logger?: Logger } = {}) {
  const { logger } = options;
  const graceMs = options.graceMs ?? TURN_REATTACH_GRACE_MS;
  const bindings = new Map<string, Binding>();
  const files = new Map<string, ArtifactAssembler>();
  const tools = toolCalls({ logger });
  let adopter: TurnAdopter | undefined;

  /** A collected file's part: the sink gets the file once it is whole and checked. */
  const artifactPart = (sink: TurnSink, frame: Extract<TurnRunnerFrame, { type: 'turn.artifact' }>) => {
    const assembler = files.get(frame.turnId) ?? artifactAssembler();
    files.set(frame.turnId, assembler);
    const done = assembler.part(frame);
    if (done === undefined) return;
    if ('dropped' in done) {
      logger?.warn(
        { turnId: frame.turnId, path: frame.path, why: done.dropped },
        'a collected file was dropped',
      );
    } else sink.artifact?.(done);
  };
  /** Ends a turn: its binding goes, its sink hears the end, and its runner the ack once that is recorded. */
  const end = (binding: Binding, ending: TurnEnding, ack?: RunnerConnection) => {
    clearTimeout(binding.grace);
    bindings.delete(binding.turnId);
    files.delete(binding.turnId);
    tools.drop(binding.turnId);
    void Promise.resolve(binding.sink.end(ending)).then(() => {
      if (ack?.hello?.caps.reattach) send(ack, { type: 'turn.ack', turnId: binding.turnId });
    });
  };
  /** The channel of a turn, which follows it from connection to connection. */
  const channelOf = (binding: Binding): TurnChannel => {
    const { turnId } = binding;
    const bound = () => (bindings.get(turnId) === binding ? binding : undefined);
    return {
      turnId,
      input: (inputId, text) => {
        const connection = bound()?.connection;
        if (connection) send(connection, { type: 'turn.input', turnId, inputId, text });
      },
      stop: () => {
        const live = bound();
        if (live?.connection) send(live.connection, { type: 'turn.stop', turnId });
        else if (live) live.stopWanted = true;
      },
    };
  };
  /** Binds a turn to a connection that took it back: its grace ends, its sink hears it is back. */
  const bind = (binding: Binding, connection: RunnerConnection) => {
    clearTimeout(binding.grace);
    binding.grace = undefined;
    binding.connection = connection;
    binding.sink.detached?.(false);
  };
  /** The sink of a turn a restarted server takes back, asked of the chats module. */
  const adoptOne = async (connection: RunnerConnection, turnId: string): Promise<Binding | undefined> => {
    const runner = { companyId: connection.runner.companyId, machineId: connection.machineId };
    const sink = await adopter?.(runner, turnId).catch((error: unknown) => {
      logger?.error({ err: error, turnId }, 'could not take back a turn');
      return undefined;
    });
    if (sink === undefined || bindings.has(turnId)) return undefined;
    const binding: Binding = {
      turnId,
      machineId: connection.machineId,
      sink,
      connection,
      grace: undefined,
      stopWanted: false,
    };
    bindings.set(turnId, binding);
    sink.adopted?.(channelOf(binding));
    return binding;
  };
  return {
    /** Starts a turn on the connection (`turn.start`); its frames go to `sink` until it ends. */
    start(connection: RunnerConnection, request: TurnRequest, sink: TurnSink): TurnChannel {
      const { turnId } = request;
      const machineId = connection.machineId;
      const binding: Binding = { turnId, machineId, sink, connection, grace: undefined, stopWanted: false };
      bindings.set(turnId, binding);
      send(connection, { type: 'turn.start', turnId, spec: request.spec });
      return channelOf(binding);
    },
    /** A turn frame from the connection's runner; one of a turn it does not carry is dropped. */
    record(connection: RunnerConnection, frame: TurnRunnerFrame): void {
      const binding = bindings.get(frame.turnId);
      if (binding?.connection !== connection) return;
      const { sink } = binding;
      if (frame.type === 'turn.events') sink.events(frame.events);
      else if (frame.type === 'turn.question') {
        const { seq, questionId, questions } = frame;
        sink.question({ seq, questionId, questions });
      } else if (frame.type === 'turn.tool') {
        const answer = sink.tool?.bind(sink);
        tools.call(frame, answer, (result) =>
          send(bindings.get(frame.turnId)?.connection ?? connection, result),
        );
      } else if (frame.type === 'turn.artifact') {
        if (frame.callId === undefined) artifactPart(sink, frame);
        else tools.part({ ...frame, callId: frame.callId });
      } else if (frame.type === 'turn.artifacts')
        sink.artifacts?.({ files: frame.files, skipped: frame.skipped });
      else end(binding, endingOf(frame), connection);
    },
    /** How many turns run on the machine, carried by a connection or waiting for their runner. */
    count(machineId: string): number {
      let running = 0;
      for (const binding of bindings.values()) if (binding.machineId === machineId) running++;
      return running;
    },
    /**
     * The connection closed: its turns wait `graceMs` for their runner when it keeps turns (`caps.reattach`), else
     * end with `machine_disconnected` (an older runner ended their processes with the link).
     */
    drop(connection: RunnerConnection): void {
      const keeps = connection.hello?.caps.reattach === true;
      for (const binding of [...bindings.values()]) {
        if (binding.connection !== connection) continue;
        if (!keeps) {
          end(binding, TURN_DISCONNECTED);
          continue;
        }
        binding.connection = undefined;
        binding.sink.detached?.(true);
        binding.grace = setTimeout(() => {
          if (bindings.get(binding.turnId) === binding) end(binding, TURN_DISCONNECTED);
        }, graceMs);
        binding.grace.unref?.();
      }
    },
    /**
     * A runner's hello (S5.4): each turn it holds is bound to its connection (taken back from the chats module when this
     * process has none) and `turn.resume` says where to resume, null for a turn the server no longer has; a waiting
     * turn of its machine it does not hold ends; a stop asked meanwhile goes now.
     */
    async resume(connection: RunnerConnection, held: readonly HeldTurn[]): Promise<void> {
      const named = new Set(held.map((turn) => turn.turnId));
      for (const binding of [...bindings.values()]) {
        const waiting = binding.machineId === connection.machineId && binding.connection === undefined;
        if (waiting && !named.has(binding.turnId)) end(binding, TURN_DISCONNECTED);
      }
      if (held.length === 0) return;
      const turns: ResumedTurn[] = [];
      const bound: Binding[] = [];
      for (const { turnId } of held) {
        const known = bindings.get(turnId);
        const binding =
          known === undefined
            ? await adoptOne(connection, turnId)
            : known.machineId === connection.machineId
              ? known
              : undefined;
        if (binding === undefined) {
          turns.push({ turnId, lastSeq: null });
          continue;
        }
        bind(binding, connection);
        bound.push(binding);
        turns.push({ turnId, lastSeq: (await binding.sink.lastSeq?.()) ?? 0 });
      }
      send(connection, { type: 'turn.resume', turns });
      for (const binding of bound) {
        if (!binding.stopWanted || bindings.get(binding.turnId) !== binding) continue;
        binding.stopWanted = false;
        send(connection, { type: 'turn.stop', turnId: binding.turnId });
      }
    },
    /** Who builds the sink of a turn a restarted server takes back (the chats module). */
    adopt(next: TurnAdopter): void {
      adopter = next;
    },
    /** The server stops: no grace runs on. */
    close(): void {
      for (const binding of bindings.values()) clearTimeout(binding.grace);
    },
  };
}

export type TurnBoard = ReturnType<typeof turnBoard>;
