import { encodeFrame, type TerminalRunnerFrame, type TerminalServerFrame } from '@mwc/shared/runner-protocol';
import type { RunnerConnection } from '../connection.ts';

/**
 * The hub's terminals (docs/machines.md, "Terminal"): each one opened on a runner connection, by session id, with the
 * sink its frames go to (the browser's relay). A session belongs to the connection that carried its `terminal.open`:
 * when that socket closes (the runner went away, or a newer connection replaced it), the runner ended the shell with
 * it, so every sink gets an end with `machine_disconnected`. Memory only.
 */

/** A terminal's new session: its id (the caller's) and its size. */
export interface TerminalRequest {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
}

/** How a terminal ended: `terminal.exit` without its type and session. */
export interface TerminalEnding {
  readonly code: number | null;
  readonly signal?: string;
  readonly error?: string;
}

/** Where a terminal's frames go. */
export interface TerminalSink {
  opened(shell: string): void;
  /** Output, base64 as the runner sent it. */
  output(data: string): void;
  /** The end; nothing follows it. */
  exit(ending: TerminalEnding): void;
}

/** One open terminal, as its opener drives it. Nothing is sent once it ended. */
export interface TerminalChannel {
  readonly sessionId: string;
  /** Typed bytes, base64, at most `TERMINAL_DATA_MAX_BYTES` of them. */
  input(data: string): void;
  resize(cols: number, rows: number): void;
  /** Ends it (`terminal.close`); its sink hears nothing more. */
  close(): void;
}

/** The end of every terminal of a connection that closed. */
export const MACHINE_DISCONNECTED: TerminalEnding = { code: null, error: 'machine_disconnected' };

/** What a `terminal.exit` says, without its unknown fields. */
function endingOf(frame: Extract<TerminalRunnerFrame, { type: 'terminal.exit' }>): TerminalEnding {
  return {
    code: frame.code,
    ...(frame.signal === undefined ? {} : { signal: frame.signal }),
    ...(frame.error === undefined ? {} : { error: frame.error }),
  };
}

export function terminalBoard() {
  const sessions = new Map<RunnerConnection, Map<string, TerminalSink>>();
  return {
    /** Opens a terminal on the connection (`terminal.open`); its frames go to `sink` until it ends. */
    open(connection: RunnerConnection, request: TerminalRequest, sink: TerminalSink): TerminalChannel {
      const { sessionId } = request;
      const own = sessions.get(connection) ?? new Map<string, TerminalSink>();
      sessions.set(connection, own.set(sessionId, sink));
      const send = (frame: TerminalServerFrame) => connection.link.send(encodeFrame(frame));
      const live = () => own.has(sessionId) && sessions.get(connection) === own;
      send({ type: 'terminal.open', ...request });
      return {
        sessionId,
        input: (data) => {
          if (live()) send({ type: 'terminal.input', sessionId, data });
        },
        resize: (cols, rows) => {
          if (live()) send({ type: 'terminal.resize', sessionId, cols, rows });
        },
        close: () => {
          if (!live()) return;
          own.delete(sessionId);
          send({ type: 'terminal.close', sessionId });
        },
      };
    },
    /** A terminal frame from the connection's runner; one of no open session is dropped. */
    record(connection: RunnerConnection, frame: TerminalRunnerFrame): void {
      const own = sessions.get(connection);
      const sink = own?.get(frame.sessionId);
      if (own === undefined || sink === undefined) return;
      if (frame.type === 'terminal.opened') sink.opened(frame.shell);
      else if (frame.type === 'terminal.output') sink.output(frame.data);
      else {
        own.delete(frame.sessionId);
        sink.exit(endingOf(frame));
      }
    },
    /** The connection closed: every terminal it carried ends with `machine_disconnected`. */
    drop(connection: RunnerConnection): void {
      const own = sessions.get(connection);
      sessions.delete(connection);
      for (const sink of own?.values() ?? []) sink.exit(MACHINE_DISCONNECTED);
    },
  };
}

export type TerminalBoard = ReturnType<typeof terminalBoard>;
