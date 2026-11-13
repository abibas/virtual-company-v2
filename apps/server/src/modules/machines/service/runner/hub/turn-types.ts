import type { TurnSpec } from '@mwc/shared/harness';
import {
  encodeFrame,
  type ServerFrame,
  type TurnArtifacts,
  type TurnEnd,
  type TurnEventItem,
  type TurnQuestion,
} from '@mwc/shared/runner-protocol';
import type { RunnerConnection } from '../connection.ts';
import type { CollectedArtifact } from './artifacts.ts';
import type { TurnToolCall, TurnToolReply } from './tools.ts';

/**
 * The contracts of the hub's chat turns (`turns.ts`): what a starter hands in (a request and its sink), what it gets
 * back (a channel), who takes a turn back after a restart (the adopter), and a turn's binding to its connection.
 */

/**
 * A turn to start: the server's id and the spec with its credential; `afterSeq` when the server keeps events of the turn
 * already (a turn started again on a fresh conversation, `turn.start.afterSeq`), so the runner numbers its own after them.
 */
export interface TurnRequest {
  readonly turnId: string;
  readonly spec: TurnSpec;
  readonly afterSeq?: number | undefined;
}

/** What runs once the runner heard a turn's `turn.ack` (its run folder gone): the same turn started again. */
export type AfterAck = () => void;

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
  /**
   * The end; nothing follows it. Resolves once it is recorded (then the runner hears `turn.ack`), with what runs after
   * that ack when the turn starts again in its place (a lost conversation started afresh, 2026-11-13).
   */
  end(ending: TurnEnding): void | Promise<void> | Promise<AfterAck | undefined>;
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

/** The end of a turn stopped while its runner was away (S5.4; at once since 2026-11-12, not after the grace). */
export const TURN_STOPPED_AWAY: TurnEnding = { ok: false, exitCode: null, error: 'stopped' };

/** What a `turn.end` says, without its unknown fields. */
export function endingOf(frame: TurnEnd): TurnEnding {
  return {
    ok: frame.ok,
    exitCode: frame.exitCode,
    ...(frame.error === undefined ? {} : { error: frame.error }),
    ...(frame.authJson === undefined ? {} : { authJson: frame.authJson }),
  };
}

/** A turn as the board holds it: its sink and the connection carrying it (none while it waits for its runner). */
export interface Binding {
  readonly turnId: string;
  readonly companyId: string;
  readonly machineId: string;
  readonly sink: TurnSink;
  connection: RunnerConnection | undefined;
  grace: ReturnType<typeof setTimeout> | undefined;
}

/** Sends a server frame on a connection. */
export const sendFrame = (connection: RunnerConnection, frame: ServerFrame) =>
  connection.link.send(encodeFrame(frame));
