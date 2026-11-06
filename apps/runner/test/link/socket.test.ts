import { RUNNER_FRAME_MAX_BYTES, RUNNER_SUBPROTOCOL, type RunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import {
  HANDSHAKE_TIMEOUT_MS,
  openSocket,
  SOCKET_OPEN,
  type SocketLike,
  type SocketOptions,
  sendFrame,
} from '../../src/link/socket.ts';
import { memoryLog } from '../fixtures/log.ts';
import { RUNNER_KEY } from '../fixtures/runner.ts';

/** A socket that keeps what it is sent. */
function fakeSocket(readyState: number): SocketLike & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    readyState,
    send: (text) => void sent.push(text),
    close: () => {},
    terminate: () => {},
    on: () => undefined,
  };
}

describe('opening the socket', () => {
  it('asks for the runner subprotocol with the key as a bearer token, the frame limit and the upgrade timeout', () => {
    const made: { url: string; protocol: string; options: SocketOptions }[] = [];
    const socket = fakeSocket(0);
    const opened = openSocket(
      class {
        constructor(url: string, protocol: string, options: SocketOptions) {
          made.push({ url, protocol, options });
          // biome-ignore lint/correctness/noConstructorReturn: a fake constructor hands out the prepared socket
          return socket;
        }
      } as never,
      'ws://127.0.0.1:9950/api/runner/ws',
      RUNNER_KEY,
    );
    expect(opened).toBe(socket);
    expect(made).toEqual([
      {
        url: 'ws://127.0.0.1:9950/api/runner/ws',
        protocol: RUNNER_SUBPROTOCOL,
        options: {
          headers: { authorization: `Bearer ${RUNNER_KEY}` },
          maxPayload: RUNNER_FRAME_MAX_BYTES,
          handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
        },
      },
    ]);
  });
});

describe('sending a frame', () => {
  const frame: RunnerFrame = { type: 'hold.state', until: null, source: 'server' };

  it('sends its JSON on an open socket only', () => {
    const { log } = memoryLog();
    const open = fakeSocket(SOCKET_OPEN);
    expect(sendFrame(open, frame, log)).toBe(true);
    expect(open.sent).toEqual([JSON.stringify(frame)]);
    const closing = fakeSocket(2);
    expect(sendFrame(closing, frame, log)).toBe(false);
    expect(closing.sent).toEqual([]);
  });

  it('logs a frame too large to send', () => {
    const { log, entries } = memoryLog();
    const huge = {
      type: 'runner.resync',
      runs: [],
      padding: 'x'.repeat(RUNNER_FRAME_MAX_BYTES),
    } as RunnerFrame;
    expect(sendFrame(fakeSocket(SOCKET_OPEN), huge, log)).toBe(false);
    expect(entries[0]).toMatchObject({ level: 'error', msg: 'cannot send a frame', type: 'runner.resync' });
  });
});
