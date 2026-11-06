import { upgradeWebSocket } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { RUNNER_FRAME_MAX_BYTES, RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import type { Context, Env, MiddlewareHandler } from 'hono';
import { type WebSocket, WebSocketServer } from 'ws';

/**
 * WebSockets on the API's own port (S4.2): `@hono/node-server` hands each upgrade request to the Hono app, so a socket
 * route is an ordinary route whose middleware (request id, log, auth) runs first and can refuse it with a status (no
 * socket then); `upgradeSocket` ends the route and opens the socket. `start.ts` gives `serve()` the one
 * `WebSocketServer` that completes the handshakes. No business rules here: a module gets a `SocketLink` per socket.
 */

/** The subprotocols the server speaks; the handshake picks the first of these the client offers. */
export const SOCKET_PROTOCOLS: readonly string[] = [RUNNER_SUBPROTOCOL];

/**
 * The server for `serve({ websocket: { server } })`: no port of its own (`noServer`), messages up to the runner
 * protocol's frame limit (a larger one closes the socket with 1009), one of `SOCKET_PROTOCOLS`.
 */
export function createSocketServer(): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    maxPayload: RUNNER_FRAME_MAX_BYTES,
    handleProtocols: (offered) => SOCKET_PROTOCOLS.find((protocol) => offered.has(protocol)) ?? false,
  });
}

/** One open socket as a module sees it. */
export interface SocketLink {
  /** The peer's address. */
  readonly remoteIp: string | null;
  /** Sends a text frame; nothing once the socket is closing. */
  send(text: string): void;
  /** Closes the socket with a code and a reason (the close handshake). */
  close(code: number, reason: string): void;
  /** Cuts the socket at once, without a handshake (the peer sees 1006). */
  terminate(): void;
}

/** What a module does with a socket's text frames and its close. */
export interface SocketHandlers {
  message(text: string): void;
  closed(code: number): void;
}

export interface SocketOptions {
  /** How often the socket is pinged; a socket that has not answered the previous ping by then is cut. */
  readonly pingMs: number;
}

/** A link over a `ws` socket. */
function linkOf(raw: WebSocket, remoteIp: string | null): SocketLink {
  return {
    remoteIp,
    send: (text) => {
      if (raw.readyState === raw.OPEN) raw.send(text);
    },
    close: (code, reason) => raw.close(code, reason),
    terminate: () => raw.terminate(),
  };
}

/** Pings the socket every `pingMs` and cuts it when the previous ping went unanswered; returns the timer to clear. */
function keepAlive(raw: WebSocket, pingMs: number): ReturnType<typeof setInterval> {
  let answered = true;
  raw.on('pong', () => {
    answered = true;
  });
  return setInterval(() => {
    if (!answered) {
      raw.terminate();
      return;
    }
    answered = false;
    raw.ping();
  }, pingMs);
}

/**
 * The end of a socket route: upgrades the request (once the route's middleware let it through) and hands `open` the
 * request's context and a link to the new socket; `open` returns its handlers. Only text frames are delivered (a binary
 * one closes the socket with 1003), and the socket is kept alive with pings.
 */
export function upgradeSocket<E extends Env>(
  open: (c: Context<E>, link: SocketLink) => SocketHandlers,
  options: SocketOptions,
): MiddlewareHandler<E> {
  return upgradeWebSocket((c) => {
    let handlers: SocketHandlers | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    return {
      onOpen(_event, ws) {
        const raw = ws.raw as WebSocket;
        timer = keepAlive(raw, options.pingMs);
        handlers = open(c as Context<E>, linkOf(raw, getConnInfo(c).remote.address ?? null));
      },
      onMessage(event, ws) {
        if (typeof event.data !== 'string') {
          ws.close(1003, 'Text frames only');
          return;
        }
        handlers?.message(event.data);
      },
      onClose(event) {
        clearInterval(timer);
        handlers?.closed(event.code);
      },
    };
  }) as unknown as MiddlewareHandler<E>;
}
