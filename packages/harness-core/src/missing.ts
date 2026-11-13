import { clipLine } from './text.ts';

/**
 * A resumed conversation the harness no longer has (docs/harness.md "A lost conversation"): its CLI says so in its own
 * words and exits, and the runner ends the turn `session_missing` so the server can start the chat afresh. Each driver
 * knows its CLI's words (`HarnessDriver.sessionMissing`); this finds them in what the process wrote.
 */

/** The longest line of the harness's own words a `session_missing` end quotes. */
export const SESSION_MISSING_LINE_MAX = 300;

/** The first line of `output` that matches `words`, on one line and cut to `SESSION_MISSING_LINE_MAX`; else undefined. */
export function lineMatching(output: string, words: RegExp): string | undefined {
  const line = output.split(/\r?\n/).find((candidate) => words.test(candidate));
  return line === undefined ? undefined : clipLine(line, SESSION_MISSING_LINE_MAX);
}
