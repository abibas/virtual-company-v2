import { RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEAD_SOCKET_MS, HELLO_WAIT_MS } from '../../../src/link/link.ts';
import { cleanUpLinks, fakeServer, HELLO, startLink } from '../../fixtures/link.ts';
import { RUNNER_KEY } from '../../fixtures/runner.ts';

afterEach(cleanUpLinks);

describe('connecting', () => {
  it('says hello with the subprotocol and the runner key, then resync and hold state, then a heartbeat', async () => {
    const server = await fakeServer();
    const { link, connected } = startLink(server.url);
    expect(await server.frames.next('runner.hello')).toEqual(HELLO);
    await server.frames.next('runner.heartbeat');
    expect(server.frames.all.map((frame) => frame.type)).toEqual([
      'runner.hello',
      'runner.resync',
      'hold.state',
      'runner.heartbeat',
    ]);
    expect(server.connections).toEqual([
      { authorization: `Bearer ${RUNNER_KEY}`, protocol: RUNNER_SUBPROTOCOL },
    ]);
    await connected();
    expect(link.connected).toBe(true);
  });

  it('sends a heartbeat every 20 s while the server pings', async () => {
    const server = await fakeServer();
    const { time } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    for (let beat = 1; beat <= 3; beat++) {
      await server.ping();
      await time.advance(19_999);
      expect(server.frames.of('runner.heartbeat')).toHaveLength(beat);
      await time.advance(1);
      expect((await server.frames.next('runner.heartbeat')).awakeMs).toBe(beat * 20_000);
    }
  });

  it('takes 40 s without a frame or a ping as a dead socket and connects again', async () => {
    const server = await fakeServer();
    const { time, logs, reconnectScheduled } = startLink(server.url);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    await server.frames.next('runner.heartbeat');
    await time.advance(40_000);
    expect(server.frames.of('runner.heartbeat')).toHaveLength(3);
    await time.advance(20_000);
    expect(await reconnectScheduled(1)).toBe(1_000);
    expect(logs.messages('warn')).toContain('nothing from the server for too long; reconnecting');
    expect(DEAD_SOCKET_MS).toBe(40_000);
    await time.advance(1_000);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    expect(server.connections).toHaveLength(2);
  });

  it('waits 15 s for server.hello, then cuts the socket and tries again', async () => {
    const server = await fakeServer({ hello: false });
    const { time, logs, reconnectScheduled, link } = startLink(server.url);
    await server.frames.next('runner.hello');
    await time.advance(HELLO_WAIT_MS);
    expect(await reconnectScheduled(1)).toBe(1_000);
    expect(logs.messages('warn')).toContain('no server.hello in time; reconnecting');
    expect(link.connected).toBe(false);
    expect(link.send({ type: 'runner.resync', runs: [] })).toBe(false);
  });
});

describe('reconnecting', () => {
  it('waits 1 s, 2 s, 4 s … with jitter while the server is down, and from 1 s again after a handshake', async () => {
    const server = await fakeServer();
    const { time, reconnectScheduled, connected } = startLink(server.url, { random: () => 0.5 });
    await server.frames.next('runner.hello');
    await server.frames.next('runner.heartbeat');
    await server.stop();
    expect(await reconnectScheduled(1)).toBe(1_100);
    await time.advance(1_100);
    expect(await reconnectScheduled(2)).toBe(2_200);
    await time.advance(2_200);
    expect(await reconnectScheduled(3)).toBe(4_400);
    await server.start();
    await time.advance(4_399);
    expect(server.connections).toHaveLength(1);
    await time.advance(1);
    await server.frames.next('runner.hello');
    await connected();
    server.dropAll();
    expect(await reconnectScheduled(4)).toBe(1_100);
  });

  it('comes back after a server restart with a new hello, resync and hold state', async () => {
    const server = await fakeServer();
    const { time, reconnectScheduled } = startLink(server.url);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    await server.frames.next('hold.state');
    await server.restart();
    expect(await reconnectScheduled(1)).toBe(1_000);
    await time.advance(1_000);
    await server.frames.next('runner.hello');
    await server.frames.next('runner.resync');
    await server.frames.next('hold.state');
    expect(server.connections).toHaveLength(2);
    expect(server.frames.of('runner.hello')).toHaveLength(2);
  });

  it('tries again when the WebSocket cannot even be made', async () => {
    let tries = 0;
    const { logs, reconnectScheduled } = startLink('ws://127.0.0.1:1/api/runner/ws', {
      WebSocket: class {
        constructor() {
          tries += 1;
          throw new Error('bad address');
        }
      } as never,
    });
    expect(await reconnectScheduled(1)).toBe(1_000);
    expect(tries).toBe(1);
    expect(logs.entries[0]).toMatchObject({ msg: 'cannot open the runner socket', error: 'bad address' });
  });
});
