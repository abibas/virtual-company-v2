import { constants } from 'node:os';
import { TERMINAL_IDLE_MS, type TerminalExit, type TerminalRunnerFrame } from '@mwc/shared/runner-protocol';
import type { Log } from '../log.ts';
import type { Timers } from '../system/time.ts';
import type { PtyProcess } from './loader.ts';
import { OutputBatcher } from './output.ts';

/**
 * One open terminal (docs/machines.md, "Terminal"): a shell in a PTY that `sessions.ts` started, its output batched
 * to the link (`output.ts`), its input written as raw bytes. It ends when the shell exits, and is ended by `close`
 * (SIGHUP, then SIGKILL 5 s later) or 60 minutes after its last input (with a notice line first). Whatever ended it, it
 * sends `terminal.exit` once, after the last of its output.
 */

/** How long after SIGHUP a shell that is still there gets SIGKILL. */
export const KILL_AFTER_MS = 5_000;

/** The line a terminal prints before it closes for lack of input. */
export const IDLE_NOTICE = '\r\n[Closing this terminal: no input for 60 minutes.]\r\n';

/** How a terminal ended, as `terminal.exit` says it. */
export type TerminalEnd = Omit<TerminalExit, 'type' | 'sessionId'>;

export interface SessionDeps {
  readonly timers: Timers;
  readonly log: Log;
  /** Sends a frame on the link; false when it is down. */
  send(frame: TerminalRunnerFrame): boolean;
  /** The bytes waiting in the link's send buffer. */
  buffered(): number;
  /** Called once, right after its `terminal.exit` was sent. */
  ended(sessionId: string): void;
}

/** The name of a signal's number (`1` → `SIGHUP`), or undefined for none. */
export function signalName(signal: number | undefined): string | undefined {
  if (!signal) return undefined;
  return Object.entries(constants.signals).find(([, number]) => number === signal)?.[0] ?? `SIG${signal}`;
}

export class TerminalSession {
  readonly sessionId: string;
  /** Resolves once its `terminal.exit` was sent. */
  readonly done: Promise<void>;
  readonly #pty: PtyProcess;
  readonly #deps: SessionDeps;
  readonly #output: OutputBatcher;
  readonly #resolve: () => void;
  #reason: string | undefined;
  #closing = false;
  #ended = false;
  #idleTimer: unknown;
  #killTimer: unknown;

  /** Takes over a started shell: says `terminal.opened`, then relays its output until it ends. */
  constructor(sessionId: string, shell: string, pty: PtyProcess, deps: SessionDeps) {
    this.sessionId = sessionId;
    this.#pty = pty;
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.done = promise;
    this.#resolve = resolve;
    this.#output = new OutputBatcher({
      timers: deps.timers,
      send: (data) => deps.send({ type: 'terminal.output', sessionId, data }),
      buffered: deps.buffered,
      pause: () => pty.pause(),
      resume: () => pty.resume(),
    });
    pty.onData((data) => this.#output.push(typeof data === 'string' ? Buffer.from(data) : data));
    pty.onExit(({ exitCode, signal }) => this.#exited(exitCode, signal));
    deps.send({ type: 'terminal.opened', sessionId, shell });
    deps.log.info('terminal opened', { sessionId, shell, pid: pty.pid });
    this.#armIdle();
  }

  /** What the person typed. */
  input(bytes: Buffer): void {
    if (this.#closing || this.#ended) return;
    this.#safely('write', () => this.#pty.write(bytes));
    this.#armIdle();
  }

  resize(cols: number, rows: number): void {
    this.#safely('resize', () => this.#pty.resize(cols, rows));
  }

  /**
   * Ends it: SIGHUP, SIGKILL 5 s later; `reason` goes in its `terminal.exit`, and `notice` is printed in it first.
   * Resolves once that is sent.
   */
  close(reason?: string, notice?: string): Promise<void> {
    if (this.#closing || this.#ended) return this.done;
    if (notice !== undefined) {
      this.#output.push(Buffer.from(notice));
      this.#output.flush();
    }
    this.#closing = true;
    this.#reason = reason;
    this.#deps.timers.clearTimeout(this.#idleTimer);
    this.#safely('SIGHUP', () => this.#pty.kill('SIGHUP'));
    this.#killTimer = this.#deps.timers.setTimeout(
      () => this.#safely('SIGKILL', () => this.#pty.kill('SIGKILL')),
      KILL_AFTER_MS,
    );
    return this.done;
  }

  #armIdle(): void {
    this.#deps.timers.clearTimeout(this.#idleTimer);
    this.#idleTimer = this.#deps.timers.setTimeout(() => {
      this.#output.push(Buffer.from(IDLE_NOTICE));
      this.#output.flush();
      void this.close('idle_timeout');
    }, TERMINAL_IDLE_MS);
  }

  /** A PTY call that may throw once the shell is gone: logged, never thrown. */
  #safely(what: string, call: () => void): void {
    try {
      call();
    } catch (error) {
      this.#deps.log.warn('a terminal call failed', { sessionId: this.sessionId, what, error });
    }
  }

  /** The shell ended (once; a second report is ignored): the rest of its output, then `terminal.exit`. */
  #exited(exitCode: number, signal: number | undefined): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#deps.timers.clearTimeout(this.#idleTimer);
    this.#deps.timers.clearTimeout(this.#killTimer);
    this.#output.close();
    const name = signalName(signal);
    const end: TerminalEnd = name === undefined ? { code: exitCode } : { code: null, signal: name };
    const exit = this.#reason === undefined ? end : { ...end, error: this.#reason };
    this.#deps.send({ type: 'terminal.exit', sessionId: this.sessionId, ...exit });
    this.#deps.log.info('terminal ended', { sessionId: this.sessionId, ...exit });
    this.#resolve();
    this.#deps.ended(this.sessionId);
  }
}
