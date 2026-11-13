import { isSlackError } from '@mwc/tools-core';
import type { SlackFetch } from '../http.ts';

/**
 * What Socket Mode's connection is given (2026-11-13): `fetch` for `apps.connections.open`, a way to open a WebSocket
 * (the platform's `WebSocket`; tests a fake), timers, the backoff and how long to wait for Slack's hello; and how a
 * failed `apps.connections.open` reads in words, and whether it is worth trying again.
 */

/** The part of a WebSocket the connection uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
}

/** Opens a WebSocket to Slack's address. */
export type OpenWebSocket = (url: string) => SocketLike;

/** Timers the connection waits with; tests fire them by hand. */
export interface SocketTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SocketOptions {
  readonly fetch: SlackFetch;
  readonly webSocket: OpenWebSocket;
  /** Node's, unless given. */
  readonly timers?: SocketTimers;
  /** The first wait before opening again and the longest: 1 s, doubling to a minute. */
  readonly backoff?: { readonly firstMs: number; readonly maxMs: number };
  /** How long a new connection may go without Slack's hello: 30 s. */
  readonly helloTimeoutMs?: number;
}

/** A failed `apps.connections.open` in words, and whether it stops the connection (a refused token) or is tried again. */
export function openWords(error: unknown): { readonly message: string; readonly fatal: boolean } {
  if (!isSlackError(error)) return { message: 'Slack could not be reached.', fatal: false };
  const said = error.slackError === null ? '' : ` (${error.slackError})`;
  if (error.code === 'needs_sign_in')
    return {
      message: `Slack refused the app-level token${said}: create a new one with connections:write and paste it.`,
      fatal: true,
    };
  if (error.code === 'forbidden' || error.code === 'bad_request' || error.code === 'not_found')
    return {
      message: `Slack refused to open Socket Mode${said}: paste an app-level token (xapp-) with connections:write, and turn Socket Mode on in the app.`,
      fatal: true,
    };
  return { message: error.message, fatal: false };
}
