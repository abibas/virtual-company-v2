import {
  encodeFrame,
  RUNNER_FRAME_MAX_BYTES,
  RUNNER_SUBPROTOCOL,
  type RunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';

/** The WebSocket a link opens (`ws`'s client in the daemon, a constructor injected in tests) and how frames go out. */

/** How long the upgrade may take. */
export const HANDSHAKE_TIMEOUT_MS = 15_000;

/** `WebSocket.OPEN`. */
export const SOCKET_OPEN = 1;

/** What the link uses of a WebSocket client. */
export interface SocketLike {
  readonly readyState: number;
  /** The bytes queued to send (`ws` has it). */
  readonly bufferedAmount?: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: 'open' | 'ping', listener: () => void): unknown;
  on(event: 'message', listener: (data: Buffer) => void): unknown;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'unexpected-response',
    listener: (request: unknown, response: { statusCode?: number }) => void,
  ): unknown;
}

export interface SocketOptions {
  readonly headers: Record<string, string>;
  readonly maxPayload: number;
  readonly handshakeTimeout: number;
}

/** The WebSocket constructor: `ws`'s in the daemon. */
export type WebSocketCtor = new (url: string, protocol: string, options: SocketOptions) => SocketLike;

/** Opens the runner socket: the subprotocol, the runner key as a bearer token, the frame limit, the upgrade timeout. */
export function openSocket(WebSocket: WebSocketCtor, url: string, key: string): SocketLike {
  return new WebSocket(url, RUNNER_SUBPROTOCOL, {
    headers: { authorization: `Bearer ${key}` },
    maxPayload: RUNNER_FRAME_MAX_BYTES,
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
  });
}

/** Sends a frame on an open socket; false when it is not open, or (logged) when the frame is too large. */
export function sendFrame(socket: SocketLike, frame: RunnerFrame, log: Log): boolean {
  if (socket.readyState !== SOCKET_OPEN) return false;
  try {
    socket.send(encodeFrame(frame));
    return true;
  } catch (error) {
    log.error('cannot send a frame', { type: frame.type, error });
    return false;
  }
}
