import {
  parseServerFrame,
  RUNNER_HEARTBEAT_MS,
  RUNNER_PING_MS,
  type RunnerFrame,
  type RunnerHello,
  type ServerFrame,
  type ServerHello,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { Clock, Timers } from '../system/time.ts';
import { backoffDelay, closeDecision, type LinkEndReason } from './reconnect.ts';
import { openSocket, SOCKET_OPEN, type SocketLike, sendFrame, type WebSocketCtor } from './socket.ts';

/**
 * The runner's one WebSocket to the server (docs/runner-protocol.md, "Connection"; opened by `socket.ts`): it says
 * `runner.hello`, waits for `server.hello`, sends what follows it (the resync and the hold state), then a heartbeat at
 * once and every 20 s. Every later server frame goes to `handle` and its answers are sent back. 40 s without a frame
 * or a ping is a dead socket. After a close it reconnects with backoff (`reconnect.ts`) until the close says to stop.
 */

/** How long to wait for `server.hello` once the socket is open. */
export const HELLO_WAIT_MS = 15_000;
/** No frame and no ping for this long: the socket is dead (the server pings every 20 s). */
export const DEAD_SOCKET_MS = 2 * RUNNER_PING_MS;
/** How long `stop()` waits for the close handshake before it cuts the socket. */
export const STOP_TIMEOUT_MS = 3_000;

export interface LinkDeps {
  readonly url: string;
  /** The runner key, read at each connect (`key.rotate` changes it). */
  readonly key: () => string;
  readonly WebSocket: WebSocketCtor;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly random: () => number;
  readonly log: Log;
  hello(): RunnerHello;
  /** The frames that follow `server.hello`: the resync and the hold state. */
  afterHello(hello: ServerHello): RunnerFrame[];
  /** The frames of each heartbeat: the first right after the handshake, then every 20 s. */
  beat(): Promise<RunnerFrame[]>;
  /** The answers to a server frame. */
  handle(frame: ServerFrame): Promise<RunnerFrame[]>;
  /** The answers to a text that is not a frame this runner reads, and why. */
  refuse(text: string, why: string): RunnerFrame[];
  /** A socket past its handshake closed (the terminals end with it). */
  dropped?(): void;
}

/** How the link ended for good, with the code (or HTTP status) and the last `server.hello`. */
export interface LinkEnd {
  readonly reason: LinkEndReason;
  readonly code?: number;
  readonly hello?: ServerHello;
}

interface Session {
  readonly socket: SocketLike;
  helloed: boolean;
  lastHeard: number;
  /** The HTTP status of a refused upgrade. */
  httpStatus: number | undefined;
  helloTimer?: unknown;
  beatTimer?: unknown;
}

export class Link {
  readonly ended: Promise<LinkEnd>;
  readonly #deps: LinkDeps;
  readonly #resolveEnded: (end: LinkEnd) => void;
  #session: Session | undefined;
  #hello: ServerHello | undefined;
  #attempt = 0;
  #reconnectTimer: unknown;
  #stopping = false;
  #done = false;

  constructor(deps: LinkDeps) {
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<LinkEnd>();
    this.ended = promise;
    this.#resolveEnded = resolve;
  }

  /** The socket is open and past its handshake. */
  get connected(): boolean {
    return this.#session?.helloed === true && this.#session.socket.readyState === SOCKET_OPEN;
  }

  start(): void {
    this.#open();
  }

  /** The bytes waiting in the socket's send buffer (0 without a socket). */
  get bufferedAmount(): number {
    return this.#session?.socket.bufferedAmount ?? 0;
  }

  /** Sends a frame when connected; false when not (what matters is sent again after the next handshake). */
  send(frame: RunnerFrame): boolean {
    const session = this.#session;
    return session?.helloed === true && this.#write(session, frame);
  }

  /** Closes the socket (1000) and stops reconnecting; resolves once it is closed. */
  async stop(): Promise<void> {
    if (this.#done) return;
    this.#stopping = true;
    this.#deps.timers.clearTimeout(this.#reconnectTimer);
    const session = this.#session;
    if (!session) {
      this.#end({ reason: 'stopped' });
      return;
    }
    const cut = this.#deps.timers.setTimeout(() => session.socket.terminate(), STOP_TIMEOUT_MS);
    session.socket.close(1000, 'runner stopping');
    await this.ended;
    this.#deps.timers.clearTimeout(cut);
  }

  #open(): void {
    const { log } = this.#deps;
    let socket: SocketLike;
    try {
      socket = openSocket(this.#deps.WebSocket, this.#deps.url, this.#deps.key());
    } catch (error) {
      log.error('cannot open the runner socket', { error });
      this.#reconnect(false);
      return;
    }
    const lastHeard = this.#deps.clock.monotonic();
    const session: Session = { socket, helloed: false, lastHeard, httpStatus: undefined };
    this.#session = session;
    socket.on('unexpected-response', (_request, response) => {
      session.httpStatus = response.statusCode;
      socket.terminate();
    });
    socket.on('error', (error) => log.warn('runner socket error', { error }));
    socket.on('open', () => this.#opened(session));
    socket.on('ping', () => {
      session.lastHeard = this.#deps.clock.monotonic();
    });
    socket.on('message', (data) => this.#received(session, String(data)));
    socket.on('close', (code, reason) => this.#closed(session, code, String(reason)));
  }

  #opened(session: Session): void {
    session.helloTimer = this.#deps.timers.setTimeout(() => {
      this.#deps.log.warn('no server.hello in time; reconnecting', { waitedMs: HELLO_WAIT_MS });
      session.socket.terminate();
    }, HELLO_WAIT_MS);
    this.#write(session, this.#deps.hello());
  }

  #received(session: Session, text: string): void {
    session.lastHeard = this.#deps.clock.monotonic();
    const parsed = parseServerFrame(text);
    if (parsed.kind !== 'frame') {
      const why = parsed.kind === 'unknown' ? `unknown command ${parsed.type}` : parsed.error.message;
      if (parsed.kind === 'invalid') this.#deps.log.warn('an invalid frame from the server', { error: why });
      for (const answer of this.#deps.refuse(text, why)) this.#write(session, answer);
      return;
    }
    const { frame } = parsed;
    if (frame.type === 'server.hello') {
      this.#handshake(session, frame);
      return;
    }
    if (!session.helloed) {
      this.#deps.log.warn('a frame before server.hello; ignored', { type: frame.type });
      return;
    }
    this.#deps.handle(frame).then(
      (answers) => {
        for (const answer of answers) this.#write(session, answer);
      },
      (error: unknown) => this.#deps.log.error('a server frame failed', { type: frame.type, error }),
    );
  }

  #handshake(session: Session, hello: ServerHello): void {
    if (session.helloed) return;
    session.helloed = true;
    this.#hello = hello;
    this.#attempt = 0;
    this.#deps.timers.clearTimeout(session.helloTimer);
    const { machineId, minRunnerVersion } = hello;
    this.#deps.log.info('connected', { machineId, minRunnerVersion });
    for (const frame of this.#deps.afterHello(hello)) this.#write(session, frame);
    void this.#beat(session);
  }

  /** A heartbeat; its timer is cleared when the socket closes, so it always runs for the current session. */
  async #beat(session: Session): Promise<void> {
    if (this.#deps.clock.monotonic() - session.lastHeard > DEAD_SOCKET_MS) {
      this.#deps.log.warn('nothing from the server for too long; reconnecting', { deadMs: DEAD_SOCKET_MS });
      session.socket.terminate();
      return;
    }
    let frames: RunnerFrame[] = [];
    try {
      frames = await this.#deps.beat();
    } catch (error) {
      this.#deps.log.error('cannot make a heartbeat', { error });
    }
    if (session !== this.#session) return;
    for (const frame of frames) this.#write(session, frame);
    session.beatTimer = this.#deps.timers.setTimeout(() => void this.#beat(session), RUNNER_HEARTBEAT_MS);
  }

  #closed(session: Session, code: number, reason: string): void {
    this.#session = undefined;
    this.#deps.timers.clearTimeout(session.helloTimer);
    this.#deps.timers.clearTimeout(session.beatTimer);
    if (session.helloed) this.#deps.dropped?.();
    if (this.#stopping) {
      this.#end({ reason: 'stopped', code });
      return;
    }
    const decision = closeDecision(code, session.httpStatus);
    if (decision.kind === 'end') {
      this.#end({ reason: decision.reason, code: session.httpStatus ?? code });
      return;
    }
    this.#deps.log.warn('disconnected', { code, reason, httpStatus: session.httpStatus });
    this.#reconnect(decision.slowest);
  }

  #reconnect(slowest: boolean): void {
    const delay = backoffDelay(slowest ? Number.POSITIVE_INFINITY : this.#attempt++, this.#deps.random);
    this.#deps.log.info('reconnecting', { inMs: delay });
    this.#reconnectTimer = this.#deps.timers.setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#open();
    }, delay);
  }

  /** Called once: `stop()` returns early once done, and no socket is left to close after an end. */
  #end(end: Omit<LinkEnd, 'hello'>): void {
    this.#done = true;
    this.#resolveEnded(this.#hello ? { ...end, hello: this.#hello } : end);
  }

  #write(session: Session, frame: RunnerFrame): boolean {
    return sendFrame(session.socket, frame, this.#deps.log);
  }
}
