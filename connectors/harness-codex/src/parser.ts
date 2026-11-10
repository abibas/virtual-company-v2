import {
  clipHead,
  countOf,
  failedResult,
  isRecord,
  type JsonRecord,
  type LineParser,
  parseJsonLine,
  stringOf,
} from '@mwc/harness-core';
import {
  NOTICE_MAX,
  RESULT_ERROR_MAX,
  SESSION_ID_PATTERN,
  type TurnEvent,
  type TurnEventOf,
} from '@mwc/shared/harness';
import { completedEvents, newItemState, startedEvents, todoEvents } from './items.ts';
import { type CodexReading, readingEvent } from './reading.ts';
import { collabEvents, endedSubagents, newCollabState, type ReadChild } from './subagents.ts';

/** Codex's own reading of a thread (its session file, `rollout.ts`); undefined when there is none. */
export type ReadThread = (threadId: string) => CodexReading | undefined;

/**
 * Reads `codex exec --json`: one thread event per line. `thread.started` gives the session (the thread id), the items
 * the text, thinking, tools and to-do list (`items.ts`), `turn.completed` the usage, `turn.failed` the failing end.
 * Codex's stream names no model and gives no last request's usage or window (checked in Codex 0.167.0's exec events),
 * so when the turn ends, cleanly or not, its `context` is Codex's own reading from its session file (`readThread`,
 * docs/harness.md, "Codex's context reading"): the model it ran, its window and the conversation's size as `/status`
 * shows them. Without one (no file, nothing in it yet, or no `readThread`), `turn.completed`'s usage, the turn's sum,
 * gives a `context` marked `estimate`, which a turn with several model calls overstates. Codex has no result event of
 * its own: a clean exit after `turn.completed` ends the turn with the last agent message as the reply. An `error` event
 * is a notice (Codex also reports the retries it recovers from this way); the turn fails only when it did not complete.
 * A `collab_tool_call` item starts or moves a subagent (`subagents.ts`), read from its own session file with
 * `readChild` once it ends; those still running when the turn ends become `interrupted` before its result. Anything
 * else, and any line that is not a JSON object, gives nothing.
 */
export class CodexLineParser implements LineParser {
  readonly #items = newItemState();
  readonly #collab = newCollabState();
  readonly #readThread: ReadThread | undefined;
  readonly #readChild: ReadChild | undefined;
  #threadId: string | undefined;
  #estimate: TurnEventOf<'context'> | undefined;
  #completed = false;
  #failed = false;
  #lastError: string | undefined;
  /** The last line that was not JSON: what the turn's failure says when nothing else does. */
  #stray: string | undefined;

  constructor(readThread?: ReadThread, readChild?: ReadChild) {
    this.#readThread = readThread;
    this.#readChild = readChild;
  }

  feed(line: string): TurnEvent[] {
    const event = parseJsonLine(line);
    if (event === null) {
      if (line.trim() !== '') this.#stray = line.trim();
      return [];
    }
    switch (event.type) {
      case 'thread.started': {
        const id = stringOf(event.thread_id);
        if (id === undefined || !SESSION_ID_PATTERN.test(id)) return [];
        this.#threadId = id;
        return [{ type: 'session', sessionId: id }];
      }
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return isRecord(event.item) ? this.#item(event.type, event.item) : [];
      case 'turn.completed': {
        this.#completed = true;
        const { usage, estimate } = usageOf(event.usage);
        this.#estimate = estimate;
        return usage;
      }
      case 'turn.failed': {
        this.#failed = true;
        const said = isRecord(event.error) ? stringOf(event.error.message)?.trim() : undefined;
        const error = clipHead(
          said || this.#lastError || 'Codex reported that the turn failed.',
          RESULT_ERROR_MAX,
        );
        return [...this.#endSubagents(), { type: 'result', ok: false, error }];
      }
      case 'error': {
        const message = stringOf(event.message)?.trim();
        if (!message) return [];
        this.#lastError = message;
        return [{ type: 'notice', level: 'warn', message: clipHead(message, NOTICE_MAX) }];
      }
      default:
        return [];
    }
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    const context = this.#reading() ?? this.#estimate;
    const events: TurnEvent[] = context === undefined ? [] : [context];
    if (this.#failed) return events;
    events.push(...this.#endSubagents());
    if (this.#completed && exitCode === 0) {
      const text = this.#items.lastMessage;
      return [...events, { type: 'result', ok: true, ...(text === undefined ? {} : { text }) }];
    }
    return [...events, failedResult('codex', exitCode, [this.#lastError, stderrTail, this.#stray])];
  }

  /** An item's events: a collab call's subagents, else what `items.ts` makes of it. */
  #item(type: 'item.started' | 'item.updated' | 'item.completed', item: JsonRecord): TurnEvent[] {
    if (item.type === 'collab_tool_call') return collabEvents(item, this.#collab, this.#readChild);
    if (type === 'item.started') return startedEvents(item, this.#items);
    if (type === 'item.updated') return todoEvents(item, this.#items);
    return completedEvents(item, this.#items);
  }

  /** The subagents as the turn ends them. */
  #endSubagents(): TurnEvent[] {
    return endedSubagents(this.#collab, this.#readChild);
  }

  /** Codex's own reading of the thread, when it can be read; a failure to read is no reading. */
  #reading(): TurnEventOf<'context'> | undefined {
    if (this.#readThread === undefined || this.#threadId === undefined) return undefined;
    try {
      const reading = this.#readThread(this.#threadId);
      return reading === undefined ? undefined : readingEvent(reading);
    } catch {
      return undefined;
    }
  }
}

/**
 * `turn.completed`'s usage: input tokens (cached ones included, as Codex counts them), cached, output; and, when it
 * names its input, the conversation's size estimated from it (the uncached input and the cache reads; no cache writes),
 * the fallback when Codex's own reading cannot be read.
 */
function usageOf(usage: unknown): { usage: TurnEvent[]; estimate?: TurnEventOf<'context'> } {
  if (!isRecord(usage)) return { usage: [] };
  const input = countOf(usage.input_tokens);
  const cached = countOf(usage.cached_input_tokens);
  const output = countOf(usage.output_tokens) ?? 0;
  const events: TurnEvent[] = [
    {
      type: 'usage',
      inputTokens: input ?? 0,
      outputTokens: output,
      ...(cached === undefined ? {} : { cachedInputTokens: cached }),
    },
  ];
  if (input === undefined) return { usage: events };
  const cacheRead = Math.min(cached ?? 0, input);
  return {
    usage: events,
    estimate: {
      type: 'context',
      inputTokens: input - cacheRead,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: 0,
      outputTokens: output,
      window: null,
      estimate: true,
    },
  };
}
