import type { TurnSpec } from '@mwc/shared/harness';
import {
  encodeFrame,
  type TurnArtifacts,
  type TurnEnd,
  type TurnEventItem,
  type TurnQuestion,
  type TurnRunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerConnection } from '../connection.ts';
import { type ArtifactAssembler, artifactAssembler, type CollectedArtifact } from './artifacts.ts';

export type { CollectedArtifact } from './artifacts.ts';

/**
 * The hub's chat turns (S5.1b, docs/runner-protocol.md "Chat turns"): each one started on a runner connection, by turn
 * id, with the sink its frames go to (the chats module, which stores them). A turn belongs to the connection that
 * carried its `turn.start`: when that socket closes (the runner went away, or a newer connection replaced it), the
 * runner ended its process with it, so every sink of that connection gets an end with `machine_disconnected`. Memory
 * only: after a server restart the chats module fails the turns left running. A task step's collected files (S5.3b)
 * are put together here (`artifacts.ts`) and handed to the sink whole, with what the runner left out.
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
  /** The end; nothing follows it. */
  end(ending: TurnEnding): void;
}

/** One started turn, as its starter drives it. Nothing is sent once it ended. */
export interface TurnChannel {
  readonly turnId: string;
  /** Gives it the person's message (`turn.input`, S5.2 step 6); its echo comes back as an `input` event, or nothing. */
  input(inputId: string, text: string): void;
  /** Asks the runner to stop it (`turn.stop`); its `turn.end` follows. */
  stop(): void;
}

/** The end of every turn of a connection that closed. */
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

export function turnBoard(logger?: Logger) {
  const turns = new Map<RunnerConnection, Map<string, TurnSink>>();
  const files = new Map<string, ArtifactAssembler>();
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
  return {
    /** Starts a turn on the connection (`turn.start`); its frames go to `sink` until it ends. */
    start(connection: RunnerConnection, request: TurnRequest, sink: TurnSink): TurnChannel {
      const { turnId } = request;
      const own = turns.get(connection) ?? new Map<string, TurnSink>();
      turns.set(connection, own.set(turnId, sink));
      connection.link.send(encodeFrame({ type: 'turn.start', turnId, spec: request.spec }));
      const live = () => own.has(turnId) && turns.get(connection) === own;
      return {
        turnId,
        input: (inputId, text) => {
          if (live()) connection.link.send(encodeFrame({ type: 'turn.input', turnId, inputId, text }));
        },
        stop: () => {
          if (live()) connection.link.send(encodeFrame({ type: 'turn.stop', turnId }));
        },
      };
    },
    /** A turn frame from the connection's runner; one of no live turn is dropped. */
    record(connection: RunnerConnection, frame: TurnRunnerFrame): void {
      const own = turns.get(connection);
      const sink = own?.get(frame.turnId);
      if (own === undefined || sink === undefined) return;
      if (frame.type === 'turn.events') sink.events(frame.events);
      else if (frame.type === 'turn.question') {
        const { seq, questionId, questions } = frame;
        sink.question({ seq, questionId, questions });
      } else if (frame.type === 'turn.artifact') artifactPart(sink, frame);
      else if (frame.type === 'turn.artifacts')
        sink.artifacts?.({ files: frame.files, skipped: frame.skipped });
      else {
        own.delete(frame.turnId);
        files.delete(frame.turnId);
        sink.end(endingOf(frame));
      }
    },
    /** How many turns run on the machine's connections. */
    count(machineId: string): number {
      let running = 0;
      for (const [connection, own] of turns) if (connection.machineId === machineId) running += own.size;
      return running;
    },
    /** The connection closed: every turn it carried ends with `machine_disconnected`. */
    drop(connection: RunnerConnection): void {
      const own = turns.get(connection);
      turns.delete(connection);
      for (const [turnId, sink] of own ?? []) {
        files.delete(turnId);
        sink.end(TURN_DISCONNECTED);
      }
    },
  };
}

export type TurnBoard = ReturnType<typeof turnBoard>;
