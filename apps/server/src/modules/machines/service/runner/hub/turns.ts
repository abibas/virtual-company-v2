import { type HeldTurn, TURN_REATTACH_GRACE_MS, type TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { type AwayWhy, awayError } from '../../../rules/away.ts';
import type { RunnerConnection } from '../connection.ts';
import { type ArtifactAssembler, artifactAssembler } from './artifacts.ts';
import { toolCalls } from './tools.ts';
import { resume } from './turn-resume.ts';
import {
  type Binding,
  endingOf,
  sendFrame as send,
  TURN_STOPPED_AWAY,
  type TurnAdopter,
  type TurnChannel,
  type TurnEnding,
  type TurnRequest,
  type TurnSink,
} from './turn-types.ts';

export type { CollectedArtifact } from './artifacts.ts';
export type { TurnToolCall, TurnToolReply } from './tools.ts';
export type {
  TurnAdopter,
  TurnAsked,
  TurnChannel,
  TurnCollected,
  TurnEnding,
  TurnRequest,
  TurnSink,
} from './turn-types.ts';

/**
 * The hub's chat turns (S5.1b, docs/runner-protocol.md "Chat turns"; S5.4, "Surviving restarts"): each turn by its id,
 * with the sink its frames go to (the chats module, which stores them) and the runner connection carrying it. A turn
 * outlives its connection when its runner keeps turns (`caps.reattach`): when that socket closes the turn is detached
 * (its sink told) and waits `graceMs` for its machine's runner to say hello with it; a hello naming it binds it to the
 * new connection and answers `turn.resume` with the last event the sink stored, so the runner resends what follows. A
 * turn this process has no binding for (the server restarted) is asked of the chats module (`adopt`), which builds its
 * sink from the database (and since 2026-11-12 also a turn it ended because its runner was away, while nothing else ran
 * in its chat). A hello that leaves out a detached turn of its machine, the grace (30 minutes) running out, and the
 * close of an older runner's connection end the turn (`machine_disconnected: <words>` naming the machine, `awayError`).
 * A stop asked while detached ends the turn at once (a runner that comes back with it hears it is gone and stops it).
 * Once a sink recorded a turn's end, the runner hears `turn.ack`. A task step's collected files
 * (S5.3b) are put together here (`artifacts.ts`) and handed to the sink whole, with what the runner left out. An agent's
 * tool call (S6a, `tools.ts`) goes to the sink and its answer back to the runner. The contracts are `turn-types.ts`'s,
 * taking turns back on a hello `turn-resume.ts`'s.
 */

export interface TurnBoardOptions {
  readonly graceMs?: number;
  readonly logger?: Logger;
  /** The machine's name, for the words of a turn whose runner went away for good; none: "The machine". */
  readonly machineName?: (companyId: string, machineId: string) => Promise<string | undefined>;
}

export function turnBoard(options: TurnBoardOptions = {}) {
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
  const end = (binding: Binding, ending: TurnEnding | Promise<TurnEnding>, ack?: RunnerConnection) => {
    clearTimeout(binding.grace);
    bindings.delete(binding.turnId);
    files.delete(binding.turnId);
    tools.drop(binding.turnId);
    void Promise.resolve(ending)
      .then((last) => binding.sink.end(last))
      .then(() => {
        if (ack?.hello?.caps.reattach) send(ack, { type: 'turn.ack', turnId: binding.turnId });
      });
  };
  /** Ends a turn whose runner went away for good, in words that name its machine (`awayError`). */
  const away = (binding: Binding, why: AwayWhy) => {
    const { companyId, machineId, turnId } = binding;
    logger?.info({ turnId, machineId, why }, 'a turn ended: its runner went away');
    const name = Promise.resolve()
      .then(() => options.machineName?.(companyId, machineId))
      .catch(() => undefined);
    end(
      binding,
      name.then((machine) => ({ ok: false, exitCode: null, error: awayError(machine, why, graceMs) })),
    );
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
        else if (live) end(live, TURN_STOPPED_AWAY);
      },
    };
  };
  return {
    /** Starts a turn on the connection (`turn.start`); its frames go to `sink` until it ends. */
    start(connection: RunnerConnection, request: TurnRequest, sink: TurnSink): TurnChannel {
      const { turnId } = request;
      const machineId = connection.machineId;
      const companyId = connection.runner.companyId;
      const binding: Binding = { turnId, companyId, machineId, sink, connection, grace: undefined };
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
     * end with `machine_disconnected: …` (an older runner ended their processes with the link).
     */
    drop(connection: RunnerConnection): void {
      const keeps = connection.hello?.caps.reattach === true;
      for (const binding of [...bindings.values()]) {
        if (binding.connection !== connection) continue;
        if (!keeps) {
          away(binding, 'old_runner');
          continue;
        }
        binding.connection = undefined;
        binding.sink.detached?.(true);
        binding.grace = setTimeout(() => {
          if (bindings.get(binding.turnId) === binding) away(binding, 'grace');
        }, graceMs);
        binding.grace.unref?.();
      }
    },
    /** A runner's hello (S5.4): the turns it holds are taken back (`turn-resume.ts`). */
    resume(connection: RunnerConnection, held: readonly HeldTurn[]): Promise<void> {
      const lost = (binding: Binding) => away(binding, 'lost');
      return resume({ bindings, lost, channelOf, adopter: () => adopter, logger }, connection, held);
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
