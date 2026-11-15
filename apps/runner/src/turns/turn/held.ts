import { PARSER_TICK_MS } from '@mwc/harness-core';
import type { KillGroup, Spawn } from '../../system/process.ts';
import { every, type Timers } from '../../system/time.ts';
import type { TurnStdin } from '../input.ts';
import { type Kept, spawnKeeper } from '../runs/kept.ts';
import { walkLadder } from './end.ts';
import type { TurnOutput } from './output.ts';
import type { TurnLaunch, TurnParts } from './parts.ts';

/** How often a live turn's output is read. */
export const JOURNAL_POLL_MS = 100;

/** Starts a fresh turn's keeper in its run folder, which starts the harness; throws when it cannot even be spawned. */
export function spawnTurnKeeper(
  spawn: Spawn,
  launch: TurnLaunch,
  parts: Pick<TurnParts, 'folder' | 'cwd'>,
): Kept {
  const { process } = launch;
  return spawnKeeper(spawn, launch.keeper, {
    dir: parts.folder.dir,
    command: process.command,
    args: process.args,
    cwd: parts.cwd,
    env: launch.env,
  });
}

/**
 * A turn's keeper as its process (`../turn.ts`) holds it (S5.4): the line to the harness's stdin, the timers that read
 * its output while it runs (every `JOURNAL_POLL_MS`, and the parser's tick when it has one) and the stop ladder's
 * timers (`walkLadder`), all cleared once the turn ended or is let go of.
 */
export class HeldKeeper {
  /** The harness's stdin through the keeper; nothing is written before a keeper is held. */
  readonly stdin: TurnStdin = {
    write: (text: string) => this.#kept?.write(text) ?? false,
    end: () => this.#kept?.end(),
  };
  readonly #deps: { readonly timers: Timers; readonly killGroup: KillGroup };
  #kept: Kept | undefined;
  #timers: (() => void)[] = [];
  #ladder: unknown[] = [];

  constructor(deps: { readonly timers: Timers; readonly killGroup: KillGroup }) {
    this.#deps = deps;
  }

  /** Holds the keeper: `gone` once it ended (or never started: `error`), its output read while it runs. */
  hold(kept: Kept, output: TurnOutput, gone: (error?: string) => void): void {
    this.#kept = kept;
    kept.gone(gone);
    const { timers } = this.#deps;
    this.#timers.push(every(timers, JOURNAL_POLL_MS, () => output.read()));
    if (output.ticks) this.#timers.push(every(timers, PARSER_TICK_MS, () => output.tick()));
  }

  /** Walks the stop ladder on the keeper's process group. */
  walkLadder(): void {
    this.#ladder = walkLadder(this.#kept, this.#deps.killGroup, this.#deps.timers);
  }

  /** Clears the output's timers and the ladder's. */
  stopTimers(): void {
    for (const stop of this.#timers.splice(0)) stop();
    for (const timer of this.#ladder.splice(0)) this.#deps.timers.clearTimeout(timer);
  }

  /** Lets go of the keeper without ending anything: the harness runs on. */
  release(): void {
    this.#kept?.release();
  }
}
