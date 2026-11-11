import type { TurnEvent } from '@mwc/shared/harness';
import type { Log } from '../system/log.ts';
import type { Timers } from '../system/time.ts';
import type { InputRecord } from './runs/folder.ts';

/**
 * A turn's stdin (docs/harness.md, "Delivery while a turn runs", S5.2 step 6). A harness that takes messages while it
 * works (`ProcessSpec.stdinOpen`: Claude Code's stream-json input) gets its first message and keeps stdin open: each
 * `turn.input` is written as one more line (the driver's `inputLine`), and the harness's echo of a message it took comes
 * back from the parser as an `input` event, kept only for a message this turn wrote (with the text it wrote: the prompt's
 * own echo and anything else go). After a result, stdin closes once the parser is settled and every message written was
 * taken, so the process ends as before; while one is still waiting, stdin stays open until the harness says nothing for
 * `INPUT_QUIET_MS`. Any other harness gets its prompt and stdin closes at once. Stdin is the keeper's (S5.4): each
 * message written and the close are recorded in the run folder, so a runner that takes the turn back after a restart
 * keeps its echoes and knows whether stdin is still open (`restore`, then the output replayed with `replaying`).
 */

/** The harness's stdin, through its keeper. */
export interface TurnStdin {
  /** Writes text; false when it no longer can. */
  write(text: string): boolean;
  end(): void;
}

/** How long stdin stays open after a result for a message the harness has not taken yet, while it prints nothing. */
export const INPUT_QUIET_MS = 30_000;

export interface TurnInputOptions {
  readonly turnId: string;
  readonly stdin: TurnStdin | undefined;
  /** The line of a message mid-turn; left out (or `open` false), stdin closes after the first message. */
  readonly line: ((text: string, id: string) => string) | undefined;
  readonly open: boolean;
  /** The parser's word that the harness answered everything it took (absent: true after a result). */
  readonly settled: () => boolean;
  readonly timers: Timers;
  readonly log: Log;
  /** Keeps each message written and the close (the run folder's `inputs.jsonl`). */
  readonly record?: (record: InputRecord) => void;
}

export class TurnInput {
  readonly #o: TurnInputOptions;
  /** Written and not taken yet: id → the text written. */
  readonly #pending = new Map<string, string>();
  #open = false;
  #quiet: unknown;
  /** While the output is read again after a restart: nothing is closed until it is through. */
  #replaying = false;
  #resultSeen = false;

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
    if (first) stdin?.write(first);
    if (stdin && open && line) {
      this.#open = true;
      return;
    }
    stdin?.end();
    this.#o.record?.({ end: true });
  }

  /**
   * A turn taken back after a restart (S5.4): the messages written before, waiting for their echo until the output is
   * read again, and whether stdin was still open. Then `replaying` is on until `replayed`.
   */
  restore(records: readonly InputRecord[]): void {
    const { stdin, line, open } = this.#o;
    this.#open = stdin !== undefined && open && line !== undefined;
    for (const record of records) {
      if ('end' in record) this.#open = false;
      else this.#pending.set(record.id, record.text);
    }
    this.#replaying = true;
  }

  /** The output before the restart is read again: a result it held closes stdin as it would have. */
  replayed(): void {
    this.#replaying = false;
    if (this.#resultSeen) this.#afterResult();
  }

  /** A message for the running turn; false when stdin no longer takes one (then the server starts it next). */
  send(inputId: string, text: string): boolean {
    const { stdin, line } = this.#o;
    if (!this.#open || !stdin || !line) return false;
    if (this.#pending.has(inputId)) return true;
    if (!stdin.write(line(text, inputId))) return false;
    this.#pending.set(inputId, text);
    this.#o.record?.({ id: inputId, text });
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
    if (result) {
      this.#resultSeen = true;
      if (!this.#replaying) this.#afterResult();
    }
    return kept;
  }

  /** Closes stdin (once): the turn takes no more messages. */
  close(why = 'ended'): void {
    if (this.#quiet !== undefined) this.#o.timers.clearTimeout(this.#quiet);
    this.#quiet = undefined;
    if (!this.#open) return;
    this.#open = false;
    this.#o.stdin?.end();
    this.#o.record?.({ end: true });
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
