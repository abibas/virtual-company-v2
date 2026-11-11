import type { LineParser, ProcessSpec } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type { TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import type { Log } from '../../system/log.ts';
import type { KillGroup, Spawn } from '../../system/process.ts';
import type { Timers } from '../../system/time.ts';
import type { ArtifactCollector } from '../artifacts/collect.ts';
import type { AskBridge } from '../ask/bridge.ts';
import { TurnInput, type TurnStdin } from '../input.ts';
import type { PrivateLease } from '../private-dir.ts';
import type { RunFolder } from '../runs/folder.ts';
import { JournalReader, type ReadAt } from '../runs/journal.ts';
import type { KeeperCommand } from '../runs/kept.ts';
import { TurnEvents } from './events.ts';
import { TurnOutput } from './output.ts';

/**
 * What a turn process (`../turn.ts`) is made of (S5.4): what it needs from the runner, what it runs with (fresh or taken
 * back from its run folder), what starts a fresh one, and its pieces wired together: the events on their way to the
 * server (`events.ts`), the harness's stdin (`../input.ts`) and its output read through the parser (`output.ts`).
 */

export interface TurnDeps {
  readonly spawn: Spawn;
  readonly killGroup: KillGroup;
  readonly timers: Timers;
  readonly log: Log;
  /** Reads a file from an offset (the journal, the end of stderr). */
  readonly readAt: ReadAt;
  /** Sends a frame on the link; false when it is down. */
  send(frame: TurnRunnerFrame): boolean;
  /** Called once, when the turn's process ended (it no longer takes a slot). */
  ended(turnId: string): void;
  /** Called once, when the turn is done with: its end acknowledged, or the turn forgotten. */
  done(turnId: string): void;
}

/** What a turn runs with, fresh or taken back. */
export interface TurnParts {
  readonly folder: RunFolder;
  readonly harness: Harness;
  readonly cwd: string;
  readonly parser: LineParser;
  readonly lease: PrivateLease | undefined;
  /** The turn's question socket, when the runner offers its tools. */
  readonly bridge?: AskBridge | undefined;
  /** The driver's line for a message mid-turn, when the process keeps stdin open (`ProcessSpec.stdinOpen`). */
  readonly inputLine?: ((text: string, id: string) => string) | undefined;
  readonly stdinOpen: boolean;
  /** A task step's outputs folder (S5.3b), collected when the process ends, before `turn.end`. */
  readonly artifacts?: ArtifactCollector | undefined;
}

/** What starts a fresh turn's process. */
export interface TurnLaunch {
  readonly process: ProcessSpec;
  readonly env: Readonly<Record<string, string>>;
  readonly keeper: KeeperCommand;
  readonly startedAt: number;
}

/** A turn's events, stdin and output, wired: the output's offset numbers the events, the input filters its echoes. */
export function wireTurn(turnId: string, parts: TurnParts, deps: TurnDeps, stdin: TurnStdin) {
  let output: TurnOutput | undefined;
  const events = new TurnEvents({
    turnId,
    folder: parts.folder,
    timers: deps.timers,
    log: deps.log,
    send: (frame) => deps.send(frame),
    offset: () => output?.offset ?? 0,
  });
  const input = new TurnInput({
    turnId,
    stdin,
    line: parts.inputLine,
    open: parts.stdinOpen,
    settled: () => parts.parser.settled?.() ?? true,
    timers: deps.timers,
    log: deps.log,
    record: (record) => parts.folder.appendInput(record),
  });
  const journal = new JournalReader(parts.folder.path('out'), deps.readAt);
  output = new TurnOutput({ journal, parser: parts.parser, input, events });
  return { events, input, output };
}
