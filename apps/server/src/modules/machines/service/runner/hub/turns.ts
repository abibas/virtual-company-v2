import type { TurnSpec } from '@mwc/shared/harness';
import {
  encodeFrame,
  type TurnEnd,
  type TurnEventItem,
  type TurnQuestion,
  type TurnRunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { RunnerConnection } from '../connection.ts';

/**
 * The hub's chat turns (S5.1b, docs/runner-protocol.md "Chat turns"): each one started on a runner connection, by turn
 * id, with the sink its frames go to (the chats module, which stores them). A turn belongs to the connection that
 * carried its `turn.start`: when that socket closes (the runner went away, or a newer connection replaced it), the
 * runner ended its process with it, so every sink of that connection gets an end with `machine_disconnected`. Memory
 * only: after a server restart the chats module fails the turns left running.
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

/** Where a turn's frames go, in the order the runner sent them. */
export interface TurnSink {
  events(items: readonly TurnEventItem[]): void;
  /** The agent asked the person, between the events numbered before and after `seq`. */
  question(asked: TurnAsked): void;
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

export function turnBoard() {
  const turns = new Map<RunnerConnection, Map<string, TurnSink>>();
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
      } else {
        own.delete(frame.turnId);
        sink.end(endingOf(frame));
      }
    },
    /** The connection closed: every turn it carried ends with `machine_disconnected`. */
    drop(connection: RunnerConnection): void {
      const own = turns.get(connection);
      turns.delete(connection);
      for (const sink of own?.values() ?? []) sink.end(TURN_DISCONNECTED);
    },
  };
}

export type TurnBoard = ReturnType<typeof turnBoard>;
