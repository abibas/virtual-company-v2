import {
  clipHead,
  countOf,
  failedResult,
  isRecord,
  type LineParser,
  parseJsonLine,
  stringOf,
} from '@mwc/harness-core';
import { NOTICE_MAX, RESULT_ERROR_MAX, SESSION_ID_PATTERN, type TurnEvent } from '@mwc/shared/harness';
import { completedEvents, newItemState, startedEvents } from './items.ts';

/**
 * Reads `codex exec --json`: one thread event per line. `thread.started` gives the session (the thread id), the items
 * the text and the tools (`items.ts`), `turn.completed` the usage, `turn.failed` the failing end. Codex has no result
 * event of its own: a clean exit after `turn.completed` ends the turn with the last agent message as the reply. An
 * `error` event is a notice (Codex also reports the retries it recovers from this way); the turn fails only when it
 * did not complete. Anything else, and any line that is not a JSON object, gives nothing.
 */
export class CodexLineParser implements LineParser {
  readonly #items = newItemState();
  #completed = false;
  #failed = false;
  #lastError: string | undefined;
  /** The last line that was not JSON: what the turn's failure says when nothing else does. */
  #stray: string | undefined;

  feed(line: string): TurnEvent[] {
    const event = parseJsonLine(line);
    if (event === null) {
      if (line.trim() !== '') this.#stray = line.trim();
      return [];
    }
    switch (event.type) {
      case 'thread.started': {
        const id = stringOf(event.thread_id);
        return id !== undefined && SESSION_ID_PATTERN.test(id) ? [{ type: 'session', sessionId: id }] : [];
      }
      case 'item.started':
        return isRecord(event.item) ? startedEvents(event.item, this.#items) : [];
      case 'item.completed':
        return isRecord(event.item) ? completedEvents(event.item, this.#items) : [];
      case 'turn.completed':
        this.#completed = true;
        return usageEvents(event.usage);
      case 'turn.failed': {
        this.#failed = true;
        const said = isRecord(event.error) ? stringOf(event.error.message)?.trim() : undefined;
        const error = clipHead(
          said || this.#lastError || 'Codex reported that the turn failed.',
          RESULT_ERROR_MAX,
        );
        return [{ type: 'result', ok: false, error }];
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
    if (this.#failed) return [];
    if (this.#completed && exitCode === 0) {
      const text = this.#items.lastMessage;
      return [{ type: 'result', ok: true, ...(text === undefined ? {} : { text }) }];
    }
    return [failedResult('codex', exitCode, [this.#lastError, stderrTail, this.#stray])];
  }
}

/** `turn.completed`'s usage: input tokens (cached ones included, as Codex counts them), cached, output. */
function usageEvents(usage: unknown): TurnEvent[] {
  if (!isRecord(usage)) return [];
  const cached = countOf(usage.cached_input_tokens);
  return [
    {
      type: 'usage',
      inputTokens: countOf(usage.input_tokens) ?? 0,
      outputTokens: countOf(usage.output_tokens) ?? 0,
      ...(cached === undefined ? {} : { cachedInputTokens: cached }),
    },
  ];
}
