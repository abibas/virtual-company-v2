import {
  countOf,
  failedResult,
  type JsonRecord,
  type LineParser,
  parseJsonLine,
  stringOf,
} from '@mwc/harness-core';
import { SESSION_ID_PATTERN, type TurnEvent } from '@mwc/shared/harness';
import { inputEvent, isReplay } from './input.ts';
import { assistantEvents, resultEvents, userEvents } from './messages.ts';
import { newClaudeState } from './state.ts';
import { interruptedSubagents } from './subagents.ts';
import { systemEvents } from './system.ts';

/**
 * Reads `claude -p --output-format stream-json --verbose`: one JSON message per line. The first message with a
 * session id (`system/init`) gives the session; `system` messages give the turn's settings, notices, compactions and
 * subagents (`system.ts`), `assistant`, `user` and `result` messages the rest (`messages.ts`), with what the turn keeps
 * between lines in one state (`state.ts`). The result is the last event: what comes after it gives nothing, unless
 * Claude Code echoes a message it took after it (S5.2 step 6, `input.ts`): the echo gives `input` and the turn goes on
 * in the same process, to its next result; so does a result that says a message waits (`queued_turn_count`). The
 * parser is settled at a result that says none waits, until the next echo. Anything else, and any line that is not a JSON object, gives nothing.
 */
export class ClaudeLineParser implements LineParser {
  readonly #state = newClaudeState();
  #sessionId: string | null = null;
  #resultSeen = false;
  /** A result came and nothing waits: the lines after it give nothing (until an echo). */
  #closed = false;
  #settled = false;
  /** The last line that was not JSON: what the turn's failure says when stderr is empty. */
  #stray: string | undefined;

  feed(line: string): TurnEvent[] {
    const message = parseJsonLine(line);
    if (message === null) {
      if (line.trim() !== '') this.#stray = line.trim();
      return [];
    }
    if (isReplay(message)) return this.#replay(message);
    if (this.#closed) return [];
    const events = this.#session(message);
    switch (message.type) {
      case 'system':
        events.push(...systemEvents(message, this.#state));
        break;
      case 'assistant':
        events.push(...assistantEvents(message, this.#state));
        break;
      case 'user':
        events.push(...userEvents(message, this.#state));
        break;
      case 'result':
        events.push(...resultEvents(message, this.#state));
        this.#resultSeen = true;
        this.#settled = (countOf(message.queued_turn_count) ?? 0) === 0;
        this.#closed = this.#settled;
        break;
    }
    return events;
  }

  settled(): boolean {
    return this.#settled;
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    if (this.#resultSeen) return [];
    return [
      ...interruptedSubagents(this.#state),
      failedResult('claude_code', exitCode, [stderrTail, this.#stray]),
    ];
  }

  /** A message Claude Code took: its `input` event, and the turn goes on (one taken after the result runs as more). */
  #replay(message: JsonRecord): TurnEvent[] {
    const event = inputEvent(message);
    if (event === undefined) return [];
    this.#resultSeen = false;
    this.#closed = false;
    this.#settled = false;
    return [event];
  }

  #session(message: JsonRecord): TurnEvent[] {
    const id = stringOf(message.session_id);
    if (this.#sessionId !== null || id === undefined || !SESSION_ID_PATTERN.test(id)) return [];
    this.#sessionId = id;
    return [{ type: 'session', sessionId: id }];
  }
}
