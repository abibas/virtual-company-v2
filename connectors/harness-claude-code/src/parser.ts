import { failedResult, type JsonRecord, type LineParser, parseJsonLine, stringOf } from '@mwc/harness-core';
import { SESSION_ID_PATTERN, type TurnEvent } from '@mwc/shared/harness';
import { assistantEvents, resultEvents, userEvents } from './messages.ts';
import { newClaudeState } from './state.ts';
import { interruptedSubagents } from './subagents.ts';
import { systemEvents } from './system.ts';

/**
 * Reads `claude -p --output-format stream-json --verbose`: one JSON message per line. The first message with a
 * session id (`system/init`) gives the session; `system` messages give the turn's settings, notices, compactions and
 * subagents (`system.ts`), `assistant`, `user` and `result` messages the rest (`messages.ts`), with what the turn keeps
 * between lines in one state (`state.ts`). The result is the last event: what comes after it gives nothing. Anything
 * else, and any line that is not a JSON object, gives nothing.
 */
export class ClaudeLineParser implements LineParser {
  readonly #state = newClaudeState();
  #sessionId: string | null = null;
  #resultSeen = false;
  /** The last line that was not JSON: what the turn's failure says when stderr is empty. */
  #stray: string | undefined;

  feed(line: string): TurnEvent[] {
    const message = parseJsonLine(line);
    if (message === null) {
      if (line.trim() !== '') this.#stray = line.trim();
      return [];
    }
    if (this.#resultSeen) return [];
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
        break;
    }
    return events;
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    if (this.#resultSeen) return [];
    return [
      ...interruptedSubagents(this.#state),
      failedResult('claude_code', exitCode, [stderrTail, this.#stray]),
    ];
  }

  #session(message: JsonRecord): TurnEvent[] {
    const id = stringOf(message.session_id);
    if (this.#sessionId !== null || id === undefined || !SESSION_ID_PATTERN.test(id)) return [];
    this.#sessionId = id;
    return [{ type: 'session', sessionId: id }];
  }
}
