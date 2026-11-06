import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RUNNER_FRAME_MAX_BYTES, RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSocketServer,
  SOCKET_PROTOCOLS,
  type SocketLink,
  upgradeSocket,
} from '../../../src/platform/realtime/sockets.ts';
import { eventually, listen, rawClient } from '../../fixtures/platform/realtime.ts';

/** What the test route's sockets did: the links it was given, the frames it read, how each closed. */
const links: SocketLink[] = [];
const messages: string[] = [];
const closes: number[] = [];
let server: Server;
let url: string;

beforeAll(async () => {
  const app = new Hono().get(
    '/ws',
    upgradeSocket(
      (_c, link) => {
        links.push(link);
        return {
          message(text) {
            messages.push(text);
            if (text === 'close') link.close(4000, 'asked');
            else if (text === 'cut') link.terminate();
            else link.send(`echo:${text}`);
          },
          closed(code) {
            closes.push(code);
            link.send('too late');
          },
        };
      },
      { pingMs: 40 },
    ),
  );
  server = await listen(app.fetch);
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('createSocketServer', () => {
  it("takes no port of its own, the runner protocol's frame limit, and only the subprotocols the server speaks", () => {
    const sockets = createSocketServer();
    expect(sockets.options).toMatchObject({ noServer: true, maxPayload: RUNNER_FRAME_MAX_BYTES });
    expect(SOCKET_PROTOCOLS).toEqual([RUNNER_SUBPROTOCOL]);
    const pick = sockets.options.handleProtocols as (
      offered: Set<string>,
      request: IncomingMessage,
    ) => unknown;
    expect(pick(new Set(['chat', RUNNER_SUBPROTOCOL]), {} as IncomingMessage)).toBe(RUNNER_SUBPROTOCOL);
    expect(pick(new Set(['chat']), {} as IncomingMessage)).toBe(false);
  });
});

describe('upgradeSocket', () => {
  it("hands the route a link with the peer's address: text frames in and out, and its close", async () => {
    const client = await rawClient(url);
    client.socket.send('hi');
    client.socket.send('close');
    expect(await client.closed).toBe(4000);
    expect(client.received).toEqual(['echo:hi']);
    expect(messages).toEqual(expect.arrayContaining(['hi', 'close']));
    expect(links.at(-1)?.remoteIp).toMatch(/127\.0\.0\.1/);
    // The server sees the close a moment after the client does.
    await eventually('the route saw the close', () => closes.includes(4000));
  });

  it('closes a socket that sends a binary frame (1003), and cuts one on request (1006)', async () => {
    const binary = await rawClient(url);
    binary.socket.send(Buffer.from([1, 2, 3]));
    expect(await binary.closed).toBe(1003);
    const cut = await rawClient(url);
    cut.socket.send('cut');
    expect(await cut.closed).toBe(1006);
  });

  it('pings every socket, and cuts one that leaves a ping unanswered', async () => {
    let pings = 0;
    const answering = await rawClient(url);
    answering.socket.on('ping', () => pings++);
    const deaf = await rawClient(url, { autoPong: false });
    expect(await deaf.closed).toBe(1006);
    expect(pings).toBeGreaterThan(0);
    expect(answering.socket.readyState).toBe(answering.socket.OPEN);
    answering.socket.close();
    await answering.closed;
  });
});
