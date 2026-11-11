import type { LineParser } from '@mwc/harness-core';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnInput } from '../input.ts';
import type { JournalLine, JournalReader } from '../runs/journal.ts';
import type { TurnEvents } from './events.ts';

/**
 * A turn's output (S5.4): the harness's stdout journal read line by line through the driver's parser and the input's
 * filter (the echoes of this turn's messages kept, `input.ts`) into the turn's events, its last `result` kept. A turn
 * taken back after a runner restart reads the journal again from its start up to where the log says the earlier
 * runner got (`replay`): the parser and the input are back where they were, nothing is numbered twice.
 */

export class TurnOutput {
  readonly #journal: JournalReader;
  readonly #parser: LineParser;
  readonly #input: TurnInput;
  readonly #events: TurnEvents;
  /** How far the lines whose events were numbered go. */
  #consumed = 0;
  #result: Extract<TurnEvent, { type: 'result' }> | undefined;

  constructor(parts: {
    readonly journal: JournalReader;
    readonly parser: LineParser;
    readonly input: TurnInput;
    readonly events: TurnEvents;
  }) {
    this.#journal = parts.journal;
    this.#parser = parts.parser;
    this.#input = parts.input;
    this.#events = parts.events;
  }

  /** How far into the journal the numbered events go (a log record's `o`). */
  get offset(): number {
    return this.#consumed;
  }

  /** The harness's last result so far. */
  get result(): Extract<TurnEvent, { type: 'result' }> | undefined {
    return this.#result;
  }

  /** A result an earlier runner saw (a finished turn taken back, whose output is not read again). */
  set result(result: Extract<TurnEvent, { type: 'result' }> | undefined) {
    this.#result = result;
  }

  /** Events that come from elsewhere than a line (the driver's notices, a parser's tick). */
  push(events: readonly TurnEvent[]): void {
    for (const event of events) if (event.type === 'result') this.#result = event;
    this.#events.push(events);
  }

  /** The lines written since the last read, through the parser into events. */
  read(): void {
    for (const line of this.#journal.lines()) this.#line(line);
  }

  /** The output before a restart, up to `offset`, read again for the parser's and the input's state only. */
  replay(offset: number): void {
    for (const { line, end } of this.#journal.lines(offset)) {
      const events = this.#input.filter(this.#parser.feed(line));
      for (const event of events) if (event.type === 'result') this.#result = event;
      this.#consumed = end;
    }
    this.#input.replayed();
  }

  /** The process ended: the rest of the output, a last line without its newline, then the parser's last events. */
  end(exitCode: number | null, detail: string): void {
    this.read();
    const rest = this.#journal.rest();
    if (rest !== undefined) this.#line(rest);
    this.push(this.#parser.end(exitCode, detail));
  }

  /** What the parser follows outside the output (Codex's session files). */
  tick(): void {
    const tick = this.#parser.tick?.bind(this.#parser);
    if (tick) this.push(tick());
  }

  get ticks(): boolean {
    return this.#parser.tick !== undefined;
  }

  #line({ line, end }: JournalLine): void {
    this.#input.activity();
    const events = this.#input.filter(this.#parser.feed(line));
    this.#consumed = end;
    this.push(events);
  }
}
