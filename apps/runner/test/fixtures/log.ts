import { createLog, type Log, type LogLevel } from '../../src/log.ts';

export interface LogEntry {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [field: string]: unknown;
}

/** A real JSON-lines log whose lines are kept, parsed, for the test to read. */
export function memoryLog(now: () => number = () => 0): {
  log: Log;
  entries: LogEntry[];
  lines: string[];
  messages(level?: LogLevel): string[];
} {
  const lines: string[] = [];
  const entries: LogEntry[] = [];
  const log = createLog((line) => {
    lines.push(line);
    entries.push(JSON.parse(line) as LogEntry);
  }, now);
  const messages = (level?: LogLevel) =>
    entries.filter((entry) => level === undefined || entry.level === level).map((entry) => entry.msg);
  return { log, entries, lines, messages };
}
