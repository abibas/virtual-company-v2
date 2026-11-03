import pino, { type Logger } from 'pino';

/** One parsed pino line. */
export interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** pino's numeric levels, for assertions on captured lines. */
export const LEVEL = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;

/** A pino logger at debug that keeps every line (parsed) in `lines` and prints nothing. */
export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (line: string) => lines.push(JSON.parse(line) as LogLine) },
  );
  return { logger, lines };
}
