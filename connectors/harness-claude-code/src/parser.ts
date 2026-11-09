import { failedResult, type JsonRecord, type LineParser, parseJsonLine, stringOf } from '@mwc/harness-core';
import { SESSION_ID_PATTERN, type TurnEvent } from '@mwc/shared/harness';
import { assistantEvents, resultEvents, systemEvents, userEvents } from './messages.ts';

/**
 * Reads `claude -p --output-format stream-json --verbose`: one JSON message per line. The first message with a
 * session id (`system/init`) gives the session; `assistant`, `user` and `result` messages give the rest
 * (`messages.ts`); anything else, and any line that is not a JSON object, gives nothing.
 */
export class ClaudeLineParser implements LineParser {
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
    const events = this.#session(message);
    switch (message.type) {
      case 'system':
        events.push(...systemEvents(message));
        break;
      case 'assistant':
        events.push(...assistantEvents(message));
        break;
      case 'user':
        events.push(...userEvents(message));
        break;
      case 'result':
        events.push(...resultEvents(message));
        this.#resultSeen = true;
        break;
    }
    return events;
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    return this.#resultSeen ? [] : [failedResult('claude_code', exitCode, [stderrTail, this.#stray])];
  }

  #session(message: JsonRecord): TurnEvent[] {
    const id = stringOf(message.session_id);
    if (this.#sessionId !== null || id === undefined || !SESSION_ID_PATTERN.test(id)) return [];
    this.#sessionId = id;
    return [{ type: 'session', sessionId: id }];
  }
}
