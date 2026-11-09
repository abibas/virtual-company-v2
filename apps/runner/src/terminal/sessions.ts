import {
  TERMINAL_SESSIONS_MAX,
  type TerminalOpen,
  type TerminalRunnerFrame,
  type TerminalServerFrame,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../log.ts';
import type { Timers } from '../system/time.ts';
import type { PtyProcess, PtySpawn } from './loader.ts';
import { TerminalSession } from './session.ts';
import { type Env, LOGIN_FLAG, loginShell, TERMINAL_TERM, terminalEnv } from './shell.ts';

/**
 * The machine's terminals (docs/machines.md, "Terminal"): `terminal.open` starts a login shell in a PTY (at most 4 at
 * once), the other terminal frames go to their session, and every open terminal counts for the runner's own hold (live
 * work, as a live run). They all end when the link drops (nothing can reach them then) and when the runner stops (each
 * with `runner_stopping` in its `terminal.exit`, sent before the link closes). An open the runner refuses is answered
 * at once with `terminal.exit` and why: `terminal_unavailable` (no PTY here), `runner_stopping`, `too_many_sessions`,
 * or `spawn_failed: …`.
 */

/** What a runner with a terminal has: the PTY that loaded, and what a shell needs from the machine. */
export interface TerminalHost {
  readonly spawn: PtySpawn;
  /** The runner's environment, which a shell gets less `MWC_*`. */
  readonly env: Env;
  /** The home folder, where a shell starts. */
  readonly home: string;
  readonly platform: NodeJS.Platform;
  exists(path: string): boolean;
}

export interface TerminalSessionsDeps {
  /** Undefined when the PTY did not load: every open is refused. */
  readonly host: TerminalHost | undefined;
  readonly timers: Timers;
  readonly log: Log;
  send(frame: TerminalRunnerFrame): boolean;
  /** The bytes waiting in the link's send buffer. */
  buffered(): number;
  /** How many terminals are open, after each change (the hold counts them). */
  count(open: number): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class TerminalSessions {
  readonly #deps: TerminalSessionsDeps;
  readonly #sessions = new Map<string, TerminalSession>();
  #stopping = false;

  constructor(deps: TerminalSessionsDeps) {
    this.#deps = deps;
  }

  /** True when this runner opens terminals (`caps.terminal`). */
  get available(): boolean {
    return this.#deps.host !== undefined;
  }

  /** How many terminals are open. */
  get open(): number {
    return this.#sessions.size;
  }

  /** A terminal frame from the server. Input, resize and close of a session it does not have are ignored. */
  handle(frame: TerminalServerFrame): void {
    if (frame.type === 'terminal.open') {
      this.#open(frame);
      return;
    }
    const session = this.#sessions.get(frame.sessionId);
    if (session === undefined) {
      this.#deps.log.info('a terminal frame for no open terminal; ignored', {
        type: frame.type,
        sessionId: frame.sessionId,
      });
    } else if (frame.type === 'terminal.input') session.input(Buffer.from(frame.data, 'base64'));
    else if (frame.type === 'terminal.resize') session.resize(frame.cols, frame.rows);
    else void session.close();
  }

  /** Ends every open terminal (SIGHUP, SIGKILL 5 s later), with `reason` in each `terminal.exit`; resolves once ended. */
  async closeAll(reason: string): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((session) => session.close(reason)));
  }

  /** The runner stops: no new terminal, and every open one ended with `runner_stopping`. */
  async stop(): Promise<void> {
    this.#stopping = true;
    await this.closeAll('runner_stopping');
  }

  #open(frame: TerminalOpen): void {
    const { sessionId } = frame;
    const { host } = this.#deps;
    if (this.#sessions.has(sessionId)) {
      this.#deps.log.warn('a second terminal.open for an open terminal; ignored', { sessionId });
      return;
    }
    if (host === undefined) this.#refuse(sessionId, 'terminal_unavailable');
    else if (this.#stopping) this.#refuse(sessionId, 'runner_stopping');
    else if (this.#sessions.size >= TERMINAL_SESSIONS_MAX) this.#refuse(sessionId, 'too_many_sessions');
    else this.#start(frame, host);
  }

  /** Answers an open it will not carry out with `terminal.exit` and why. */
  #refuse(sessionId: string, error: string): void {
    this.#deps.send({ type: 'terminal.exit', sessionId, code: null, error });
  }

  #start(frame: TerminalOpen, host: TerminalHost): void {
    const { sessionId } = frame;
    const shell = loginShell(host.env, host.exists);
    let pty: PtyProcess;
    try {
      pty = host.spawn(shell, [LOGIN_FLAG], {
        name: TERMINAL_TERM,
        cols: frame.cols,
        rows: frame.rows,
        cwd: host.home,
        env: terminalEnv(host.env, host.platform),
        encoding: null,
      });
    } catch (error) {
      this.#deps.log.warn('a terminal could not start', { sessionId, shell, error });
      this.#refuse(sessionId, `spawn_failed: ${messageOf(error)}`);
      return;
    }
    const session = new TerminalSession(sessionId, shell, pty, {
      timers: this.#deps.timers,
      log: this.#deps.log,
      send: (sent) => this.#deps.send(sent),
      buffered: () => this.#deps.buffered(),
      ended: (id) => {
        this.#sessions.delete(id);
        this.#deps.count(this.#sessions.size);
      },
    });
    this.#sessions.set(sessionId, session);
    this.#deps.count(this.#sessions.size);
  }
}
