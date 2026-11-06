/**
 * Socket tests' helpers: an app served for real on 127.0.0.1 and an ephemeral port with the socket server `start`
 * gives `serve()`, and a raw WebSocket client for what `FakeRunner` never does (no hello, broken frames, no pongs).
 */
import { once } from 'node:events';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import { createSocketServer } from '../../../src/platform/realtime/sockets.ts';

/** Serves an app on 127.0.0.1 and a port the system picks, with the socket server `start` gives `serve()`. */
export async function listen(fetch: (request: Request) => Response | Promise<Response>): Promise<Server> {
  const server = serve({
    fetch,
    port: 0,
    hostname: '127.0.0.1',
    websocket: { server: createSocketServer() as never },
  }) as Server;
  if (!server.listening) await once(server, 'listening');
  return server;
}

export interface RawClient {
  readonly socket: WebSocket;
  /** Every text frame received. */
  readonly received: string[];
  /** How the socket closed, once it does. */
  readonly closed: Promise<number>;
}

/**
 * A plain WebSocket client at `url`, open (it rejects when the upgrade is refused), speaking `mwc-runner.v1` with
 * `key` as its bearer unless told otherwise; `autoPong: false` leaves the server's pings unanswered.
 */
export async function rawClient(
  url: string,
  options: { readonly key?: string; readonly protocol?: string; readonly autoPong?: boolean } = {},
): Promise<RawClient> {
  const headers: Record<string, string> =
    options.key === undefined ? {} : { authorization: `Bearer ${options.key}` };
  const socket = new WebSocket(url, options.protocol ?? RUNNER_SUBPROTOCOL, {
    headers,
    autoPong: options.autoPong ?? true,
  });
  const received: string[] = [];
  socket.on('message', (data) => received.push(String(data)));
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, received, closed };
}

/** Polls `check` until it returns true (every 10 ms, up to `timeoutMs`); fails the test with `what` otherwise. */
export async function eventually(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Not within ${timeoutMs} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
