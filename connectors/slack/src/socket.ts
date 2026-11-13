import type { SlackSocket, SlackSocketHandlers, SlackSockets } from '@mwc/tools-core';
import { type SlackFetch, slackHttp } from './http.ts';
import { frameOf, recentIds } from './socket/frames.ts';
import { openWords, type SocketLike, type SocketOptions, type SocketTimers } from './socket/options.ts';

/**
 * Slack's Socket Mode (2026-11-13): `apps.connections.open` with the app-level token gives a `wss://…slack.com` address
 * for one connection, on which Slack says `hello`, then sends envelopes. Each envelope is acked at once (`{envelope_id}`,
 * Slack wants it within 3 s), before anything else; one seen before (by its envelope id, or its event's id, since Slack
 * sends an event again when an ack came late) is acked and dropped. A `disconnect` (Slack refreshes a connection every
 * few hours, and warns before) opens a new connection at once, unless it says Socket Mode was turned off
 * (`link_disabled`), which stops it with that said. A connection that closes, or says no hello in time, is opened again
 * after a backoff (1 s, doubling up to a minute, back to 1 s after a hello). A refused token (`invalid_auth`, a token of
 * another kind) stops it in words; Slack being away retries. `close` ends it for good. `fetch`, the WebSocket and the
 * timers are injected, so tests drive it with fakes and nothing reaches Slack.
 */

export type { OpenWebSocket, SocketLike, SocketOptions, SocketTimers } from './socket/options.ts';

export const DEFAULT_BACKOFF = { firstMs: 1_000, maxMs: 60_000 } as const;
export const DEFAULT_HELLO_TIMEOUT_MS = 30_000;
/** The most envelope and event ids remembered. */
export const SEEN_MAX = 2_000;

const NODE_TIMERS: SocketTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A WebSocket address Slack may hand out: `wss://` on slack.com. */
export function isSlackSocketUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'wss:' &&
      (parsed.hostname === 'slack.com' || parsed.hostname.endsWith('.slack.com'))
    );
  } catch {
    return false;
  }
}

/** One app's connection (see above). */
class Connection {
  readonly #options: SocketOptions;
  readonly #token: string;
  readonly #handlers: SlackSocketHandlers;
  readonly #timers: SocketTimers;
  readonly #open: (token: string) => Promise<Record<string, unknown>>;
  readonly #seen = recentIds(SEEN_MAX);
  #socket: SocketLike | undefined;
  #timer: unknown;
  #helloTimer: unknown;
  #attempt = 0;
  #closed = false;

  constructor(options: SocketOptions, token: string, handlers: SlackSocketHandlers) {
    this.#options = options;
    this.#token = token;
    this.#handlers = handlers;
    this.#timers = options.timers ?? NODE_TIMERS;
    const call = slackHttp({ fetch: options.fetch as SlackFetch, retries: 0, timeoutMs: 15_000 });
    this.#open = (appToken) => call({ token: appToken }, 'apps.connections.open');
  }

  start(): SlackSocket {
    void this.#connect();
    return { close: () => this.#close() };
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    this.#handlers.onStatus({ state: 'connecting', message: null });
    let url: unknown;
    try {
      url = (await this.#open(this.#token)).url;
    } catch (error) {
      const words = openWords(error);
      if (words.fatal) return this.#stop(words.message);
      return this.#retry(words.message);
    }
    if (this.#closed) return;
    if (!isSlackSocketUrl(url)) return this.#retry('Slack gave no Socket Mode address.');
    const socket = this.#options.webSocket(url);
    this.#socket = socket;
    const helloMs = this.#options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.#helloTimer = this.#timers.setTimeout(() => this.#drop(socket, 'Slack said no hello.'), helloMs);
    socket.addEventListener('message', (event) => this.#frame(socket, (event as { data?: unknown }).data));
    socket.addEventListener('close', () => this.#closedBy(socket));
    socket.addEventListener('error', () => undefined);
  }

  /** One frame of the current connection. */
  #frame(socket: SocketLike, data: unknown): void {
    if (socket !== this.#socket) return;
    const frame = frameOf(data);
    if (frame.kind === 'hello') {
      this.#timers.clearTimeout(this.#helloTimer);
      this.#attempt = 0;
      this.#handlers.onStatus({ state: 'connected', message: null });
    } else if (frame.kind === 'disconnect') {
      if (frame.reason === 'link_disabled')
        this.#stop(
          'Socket Mode is off for this Slack app: turn it on in the app’s settings, then here again.',
        );
      else this.#replace(socket);
    } else if (frame.kind === 'envelope') {
      socket.send(JSON.stringify({ envelope_id: frame.envelopeId }));
      const again = this.#seen.seen(`envelope:${frame.envelopeId}`);
      const eventAgain = frame.eventId !== null && this.#seen.seen(`event:${frame.eventId}`);
      if (again || eventAgain || frame.message === null) return;
      void this.#handlers.onMessage(frame.message);
    }
  }

  /** Slack asked for a new connection: the old one is let go and a new one opened at once. */
  #replace(socket: SocketLike): void {
    this.#retire(socket);
    void this.#connect();
  }

  /** The current connection closed without being asked to: open it again after the backoff. */
  #closedBy(socket: SocketLike): void {
    if (socket !== this.#socket) return;
    this.#retire(socket);
    this.#retry('Slack closed the connection.');
  }

  /** A connection with no hello in time: closed and opened again after the backoff. */
  #drop(socket: SocketLike, why: string): void {
    if (socket !== this.#socket) return;
    this.#retire(socket);
    this.#retry(why);
  }

  /** Stops listening to a connection and closes it. */
  #retire(socket: SocketLike): void {
    this.#timers.clearTimeout(this.#helloTimer);
    if (this.#socket === socket) this.#socket = undefined;
    try {
      socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  #retry(why: string): void {
    if (this.#closed) return;
    const { firstMs, maxMs } = this.#options.backoff ?? DEFAULT_BACKOFF;
    const wait = Math.min(firstMs * 2 ** this.#attempt, maxMs);
    this.#attempt++;
    const seconds = Math.ceil(wait / 1000);
    this.#handlers.onStatus({ state: 'disconnected', message: `${why} Trying again in ${seconds} s.` });
    this.#timer = this.#timers.setTimeout(() => void this.#connect(), wait);
  }

  /** Stopped by Slack's refusal: said once, nothing tried again. */
  #stop(why: string): void {
    this.#close();
    this.#handlers.onStatus({ state: 'error', message: why });
  }

  #close(): void {
    this.#closed = true;
    this.#timers.clearTimeout(this.#timer);
    if (this.#socket !== undefined) this.#retire(this.#socket);
  }
}

/** Socket Mode on these options (see above). */
export function slackSockets(options: SocketOptions): SlackSockets {
  return { open: (appToken, handlers) => new Connection(options, appToken, handlers).start() };
}
