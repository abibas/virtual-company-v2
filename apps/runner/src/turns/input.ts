import type { TurnEvent } from '@mwc/shared/harness';
import type { Log } from '../system/log.ts';
import type { Timers } from '../system/time.ts';

/**
 * A turn's stdin (docs/harness.md, "Delivery while a turn runs", S5.2 step 6). A harness that takes messages while it
 * works (`ProcessSpec.stdinOpen`: Claude Code's stream-json input) gets its first message and keeps stdin open: each
 * `turn.input` is written as one more line (the driver's `inputLine`), and the harness's echo of a message it took comes
 * back from the parser as an `input` event, kept only for a message this turn wrote (with the text it wrote: the prompt's
 * own echo and anything else go). After a result, stdin closes once the parser is settled and every message written was
 * taken, so the process ends as before; while one is still waiting, stdin stays open until the harness says nothing for
 * `INPUT_QUIET_MS`. Any other harness gets its prompt and stdin closes at once.
 */

/** How long stdin stays open after a result for a message the harness has not taken yet, while it prints nothing. */
export const INPUT_QUIET_MS = 30_000;

export interface TurnInputOptions {
  readonly turnId: string;
  readonly stdin: NodeJS.WritableStream | null | undefined;
  /** The line of a message mid-turn; left out (or `open` false), stdin closes after the first message. */
  readonly line: ((text: string, id: string) => string) | undefined;
  readonly open: boolean;
  /** The parser's word that the harness answered everything it took (absent: true after a result). */
  readonly settled: () => boolean;
  readonly timers: Timers;
  readonly log: Log;
}

export class TurnInput {
  readonly #o: TurnInputOptions;
  /** Written and not taken yet: id → the text written. */
  readonly #pending = new Map<string, string>();
  #open = false;
  #quiet: unknown;

  constructor(options: TurnInputOptions) {
    this.#o = options;
  }

  /** Whether more messages can go in now. */
  get open(): boolean {
    return this.#open;
  }

  /** Writes the first message; stdin stays open when the harness takes more, else closes. */
  begin(first: string | null): void {
    const { stdin, line, open } = this.#o;
    stdin?.on('error', () => {
      // A process that exits before reading its input closes the pipe: its exit says what happened.
    });
    if (stdin && open && line) {
      this.#open = true;
      stdin.write(first ?? '');
      return;
    }
    stdin?.end(first ?? '');
  }

  /** A message for the running turn; false when stdin no longer takes one (then the server starts it next). */
  send(inputId: string, text: string): boolean {
    const { stdin, line } = this.#o;
    if (!this.#open || !stdin || !line) return false;
    if (this.#pending.has(inputId)) return true;
    this.#pending.set(inputId, text);
    stdin.write(line(text, inputId));
    this.#o.log.info('turn took a message', { turnId: this.#o.turnId, inputId });
    return true;
  }

  /** The harness printed a line: a quiet wait starts again. */
  activity(): void {
    if (this.#quiet === undefined) return;
    this.#o.timers.clearTimeout(this.#quiet);
    this.#arm();
  }

  /**
   * The parser's events with the echoes of this turn's messages kept (in the text written) and the others dropped;
   * after a result, stdin closes or waits (see above).
   */
  filter(events: readonly TurnEvent[]): TurnEvent[] {
    const kept: TurnEvent[] = [];
    let result = false;
    for (const event of events) {
      if (event.type !== 'input') {
        result ||= event.type === 'result';
        kept.push(event);
        continue;
      }
      const text = event.inputId === undefined ? undefined : this.#pending.get(event.inputId);
      if (text === undefined) continue;
      this.#pending.delete(event.inputId as string);
      kept.push({ type: 'input', text, inputId: event.inputId as string });
    }
    if (result) this.#afterResult();
    return kept;
  }

  /** Closes stdin (once): the turn takes no more messages. */
  close(why = 'ended'): void {
    if (this.#quiet !== undefined) this.#o.timers.clearTimeout(this.#quiet);
    this.#quiet = undefined;
    if (!this.#open) return;
    this.#open = false;
    this.#o.stdin?.end();
    const waiting = this.#pending.size;
    this.#o.log.info('turn input closed', { turnId: this.#o.turnId, why, waiting });
  }

  #afterResult(): void {
    if (!this.#open) return;
    if (this.#pending.size === 0 && this.#o.settled()) {
      this.close('answered');
      return;
    }
    if (this.#quiet === undefined) this.#arm();
  }

  #arm(): void {
    this.#quiet = this.#o.timers.setTimeout(() => {
      this.#quiet = undefined;
      this.close('quiet');
    }, INPUT_QUIET_MS);
  }
}
