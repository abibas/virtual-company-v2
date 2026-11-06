/**
 * The runner's log: one JSON object per line on standard output (launchd, systemd's journal and `docker logs` keep
 * them), `{time, level, msg, ...fields}`. Errors in fields are written as their message. Nothing secret is ever put
 * in a field: the runner key and run secrets never reach the log.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Log {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** A field value as JSON can hold it: an error becomes its message. */
function plain(value: unknown): unknown {
  return value instanceof Error ? value.message : value;
}

/** A log that writes each entry as one JSON line through `write`, its time from `now`. */
export function createLog(write: (line: string) => void, now: () => number = Date.now): Log {
  const entry = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const body: Record<string, unknown> = { time: new Date(now()).toISOString(), level, msg };
    for (const [key, value] of Object.entries(fields)) body[key] = plain(value);
    write(`${JSON.stringify(body)}\n`);
  };
  return {
    info: (msg, fields) => entry('info', msg, fields),
    warn: (msg, fields) => entry('warn', msg, fields),
    error: (msg, fields) => entry('error', msg, fields),
  };
}
