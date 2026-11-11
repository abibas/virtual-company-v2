import { randomUUID } from 'node:crypto';
import type { AskQuestions, TurnEvent } from '@mwc/shared/harness';
import {
  EVENT_BATCH_MAX_EVENTS,
  TURN_EVENTS_BATCH_BYTES,
  type TurnEventItem,
  type TurnRunnerFrame,
  utf8Bytes,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../../system/log.ts';
import type { Timers } from '../../system/time.ts';
import { ASK_REPLY, type AskReply } from '../ask/tool.ts';
import { EventBatcher } from '../batch.ts';
import type { LogRecord, RunFolder } from '../runs/folder.ts';

/**
 * A turn's events on their way to the server (S5.4): numbered by the batcher, each kept in the run folder's log with how
 * far into the output it was read before it is sent, and sent only while the turn is attached (its link is up and,
 * after a reconnect, the server said where to resume). Detached, they wait in the log; `resend` sends the ones after
 * the server's last as `turn.events` (and `turn.question`) frames, in order, and the turn is attached again.
 */

/** Why a question was not shown: the turn is ending, or the link is down. */
export const ASK_ENDING = 'The question was not shown: this turn is ending.';
export const ASK_OFFLINE = 'The question was not shown: the runner has lost its link to the server.';

/** What stands in the log for a question that could not be sent (the agent was told it was not shown). */
export const ASK_NOT_SHOWN: TurnEvent = {
  type: 'notice',
  level: 'info',
  message:
    'The agent asked a question while the runner had lost its link to the server; it was told it was not shown.',
};

export interface TurnEventsDeps {
  readonly turnId: string;
  readonly folder: RunFolder;
  readonly timers: Timers;
  readonly log: Log;
  /** Sends a frame on the link; false when it is down. */
  send(frame: TurnRunnerFrame): boolean;
  /** How far into the output the events so far were read (a log record's `o`). */
  offset(): number;
}

const sizeOf = (value: unknown) => utf8Bytes(JSON.stringify(value));

export class TurnEvents {
  readonly #deps: TurnEventsDeps;
  readonly #batcher: EventBatcher;
  #attached = true;

  constructor(deps: TurnEventsDeps) {
    this.#deps = deps;
    this.#batcher = new EventBatcher({
      timers: deps.timers,
      record: (items) =>
        deps.folder.appendEvents(items.map((item) => ({ s: item.seq, o: deps.offset(), e: item.event }))),
      send: (events) => this.#send({ type: 'turn.events', turnId: deps.turnId, events: [...events] }),
    });
  }

  /** True while its frames go out (the link is up and the server took the turn back). */
  get attached(): boolean {
    return this.#attached;
  }

  /** The link dropped: nothing goes out until `resend`. */
  detach(): void {
    this.#attached = false;
  }

  /** The number of the last event so far. */
  get lastSeq(): number {
    return this.#batcher.lastSeq;
  }

  /** Goes on after the events of an earlier runner (a turn taken back after a restart). */
  resumeAfter(seq: number): void {
    this.#batcher.resumeAfter(seq);
  }

  push(events: readonly TurnEvent[]): void {
    this.#batcher.push(events);
  }

  flush(): void {
    this.#batcher.flush();
  }

  /** Marks the output read to its end (once its last events are kept): a runner taking the turn back parses no more. */
  finish(): void {
    this.flush();
    this.#deps.folder.appendEvents([{ fin: true, o: this.#deps.offset() }]);
  }

  /** The agent asked the person: the events so far, then the question with the next number (only while attached). */
  ask(questions: AskQuestions, ending: boolean): AskReply {
    if (ending) return { ok: false, error: ASK_ENDING };
    if (!this.#attached) return { ok: false, error: ASK_OFFLINE };
    this.flush();
    const seq = this.#batcher.reserve();
    const questionId = randomUUID();
    const { turnId, folder, offset } = this.#deps;
    folder.appendEvents([{ s: seq, o: offset(), q: { questionId, questions } }]);
    if (!this.#send({ type: 'turn.question', turnId, seq, questionId, questions })) {
      folder.appendEvents([{ s: seq, o: offset(), e: ASK_NOT_SHOWN }]);
      return { ok: false, error: ASK_OFFLINE };
    }
    this.#deps.log.info('turn asked the person', { turnId, questionId, questions: questions.length });
    return { ok: true, text: ASK_REPLY };
  }

  /**
   * Sends what the server has not stored (after `lastSeq`) from the log, in order (a number logged twice is its last
   * record: a question that could not be sent); then the turn is attached.
   */
  resend(lastSeq: number): number {
    this.#batcher.drop();
    this.#attached = true;
    const { turnId } = this.#deps;
    let batch: TurnEventItem[] = [];
    let bytes = 0;
    let sent = 0;
    const flush = () => {
      if (batch.length > 0) this.#send({ type: 'turn.events', turnId, events: batch });
      batch = [];
      bytes = 0;
    };
    const bySeq = new Map<number, Exclude<LogRecord, { fin: true }>>();
    for (const record of this.#deps.folder.events())
      if ('s' in record && record.s > lastSeq) bySeq.set(record.s, record);
    for (const record of [...bySeq.values()].sort((a, b) => a.s - b.s)) {
      sent++;
      if ('q' in record) {
        flush();
        this.#send({ type: 'turn.question', turnId, seq: record.s, ...record.q });
        continue;
      }
      const item = { seq: record.s, event: record.e };
      const size = sizeOf(item);
      if (
        batch.length >= EVENT_BATCH_MAX_EVENTS ||
        (batch.length > 0 && bytes + size > TURN_EVENTS_BATCH_BYTES)
      )
        flush();
      batch.push(item);
      bytes += size;
    }
    flush();
    return sent;
  }

  /** Sends a frame while attached; a link found down detaches the turn. */
  #send(frame: TurnRunnerFrame): boolean {
    if (!this.#attached) return false;
    if (this.#deps.send(frame)) return true;
    this.#attached = false;
    return false;
  }
}

/** What a log says of a turn taken back: its last event's number, how far the output was read, whether it was all. */
export function logState(records: readonly LogRecord[]) {
  let lastSeq = 0;
  let offset = 0;
  let finished = false;
  let result: Extract<TurnEvent, { type: 'result' }> | undefined;
  for (const record of records) {
    offset = Math.max(offset, record.o);
    if ('fin' in record) finished = true;
    else lastSeq = Math.max(lastSeq, record.s);
    if ('e' in record && record.e.type === 'result') result = record.e;
  }
  return { lastSeq, offset, finished, result };
}
