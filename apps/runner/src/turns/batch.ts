import { clipHead } from '@mwc/harness-core';
import type { TurnEvent } from '@mwc/shared/harness';
import {
  EVENT_BATCH_MAX_EVENTS,
  TURN_EVENTS_BATCH_BYTES,
  TURN_EVENTS_BATCH_MS,
  type TurnEventItem,
  utf8Bytes,
} from '@mwc/shared/runner-protocol';
import type { Timers } from '../system/time.ts';

/**
 * A turn's events on their way to the link (docs/runner-protocol.md, "Chat turns"): numbered from 1 in the order they
 * came, gathered and sent `TURN_EVENTS_BATCH_MS` after the first one, or at once from `TURN_EVENTS_BATCH_BYTES` or
 * `EVENT_BATCH_MAX_EVENTS`. Every frame stays far below the frame limit: a text longer than a batch is split into
 * several text events, and a result's text is cut to `RESULT_EVENT_MAX_BYTES` (its full reply is in the text events).
 */

/** The largest text event: a longer text is split into pieces of at most this size. */
export const TEXT_EVENT_MAX_BYTES = 16 * 1024;

/** The largest result event (sent alone when over a batch); its text is cut to fit. */
export const RESULT_EVENT_MAX_BYTES = 128 * 1024;

/** The first code units of `text` up to `n`, without a lone high surrogate at the end. */
function headOf(text: string, n: number): string {
  const head = text.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

const sizeOf = (value: unknown) => utf8Bytes(JSON.stringify(value));

/** A text in pieces whose events are each at most `TEXT_EVENT_MAX_BYTES`. */
function textPieces(text: string): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest !== '') {
    let n = Math.min(rest.length, TEXT_EVENT_MAX_BYTES / 2);
    let piece = headOf(rest, n);
    while (n > 1 && sizeOf({ type: 'text', text: piece }) > TEXT_EVENT_MAX_BYTES) {
      n = Math.floor(n / 2);
      piece = headOf(rest, n) || rest.slice(0, 2);
    }
    pieces.push(piece);
    rest = rest.slice(piece.length);
  }
  return pieces;
}

/** An event as it travels: a long text split, a long result's text cut. */
export function fitEvent(event: TurnEvent): TurnEvent[] {
  if (event.type === 'text' && sizeOf(event) > TEXT_EVENT_MAX_BYTES) {
    return textPieces(event.text).map((text) => ({ type: 'text', text }));
  }
  if (event.type === 'result' && event.text !== undefined && sizeOf(event) > RESULT_EVENT_MAX_BYTES) {
    let text = event.text;
    while (sizeOf({ ...event, text }) > RESULT_EVENT_MAX_BYTES)
      text = clipHead(text, Math.floor(text.length / 2));
    return [{ ...event, text }];
  }
  return [event];
}

export interface BatcherDeps {
  readonly timers: Timers;
  /** Sends one batch (`turn.events`). */
  send(events: readonly TurnEventItem[]): void;
}

export class EventBatcher {
  readonly #deps: BatcherDeps;
  #pending: TurnEventItem[] = [];
  #bytes = 0;
  #seq = 0;
  #timer: unknown;

  constructor(deps: BatcherDeps) {
    this.#deps = deps;
  }

  /** The number of the last event so far (0 before the first). */
  get lastSeq(): number {
    return this.#seq;
  }

  /** The next events, in order. */
  push(events: readonly TurnEvent[]): void {
    for (const event of events.flatMap(fitEvent)) this.#add({ seq: ++this.#seq, event });
  }

  /** Sends what is waiting now. */
  flush(): void {
    this.#deps.timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#pending.length === 0) return;
    const batch = this.#pending;
    this.#pending = [];
    this.#bytes = 0;
    this.#deps.send(batch);
  }

  #add(item: TurnEventItem): void {
    const size = sizeOf(item);
    if (this.#pending.length > 0 && this.#bytes + size > TURN_EVENTS_BATCH_BYTES) this.flush();
    this.#pending.push(item);
    this.#bytes += size;
    if (this.#bytes >= TURN_EVENTS_BATCH_BYTES || this.#pending.length >= EVENT_BATCH_MAX_EVENTS)
      this.flush();
    else this.#timer ??= this.#deps.timers.setTimeout(() => this.flush(), TURN_EVENTS_BATCH_MS);
  }
}
