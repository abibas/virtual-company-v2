import { afterEach, describe, expect, it } from 'vitest';
import { cleanUpLinks, fakeServer, refusingServer, startLink } from '../../fixtures/link.ts';
import { settle } from '../../fixtures/time.ts';

afterEach(cleanUpLinks);

describe('a dropped link', () => {
  it('says so once per socket that was past its handshake, and has nothing queued without a socket', async () => {
    const server = await fakeServer({ hello: false });
    let dropped = 0;
    const { link, reconnectScheduled } = startLink(server.url, { dropped: () => dropped++ });
    await server.frames.next('runner.hello');
    expect(link.bufferedAmount).toBe(0);
    server.dropAll();
    await reconnectScheduled(1);
    expect(dropped).toBe(0);
    expect(link.bufferedAmount).toBe(0);
    const helloed = await fakeServer();
    const second = startLink(helloed.url, { dropped: () => dropped++ });
    await second.connected();
    expect(second.link.bufferedAmount).toBe(0);
    helloed.dropAll();
    await second.reconnectScheduled(1);
    expect(dropped).toBe(1);
  });
});

describe('close codes', () => {
  it('ends the link when the server refuses the key at the upgrade (HTTP 401)', async () => {
    const { link, time, delays } = startLink(await refusingServer(401));
    expect(await link.ended).toEqual({ reason: 'unauthorized', code: 401 });
    expect(delays()).toEqual([]);
    expect(time.pending).toEqual([]);
  });

  it('keeps trying when the upgrade fails otherwise (a proxy answering 502)', async () => {
    const { reconnectScheduled, logs } = startLink(await refusingServer(502));
    expect(await reconnectScheduled(1)).toBe(1_000);
    expect(logs.entries.find((entry) => entry.msg === 'disconnected')).toMatchObject({ httpStatus: 502 });
  });

  it('ends the link on 4001 (key revoked while connected), naming the code', async () => {
    const server = await fakeServer();
    const { link, time, delays } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4001, 'unauthorized');
    expect(await link.ended).toMatchObject({ reason: 'unauthorized', code: 4001 });
    expect(delays()).toEqual([]);
    expect(time.pending).toEqual([]);
  });

  it('ends the link on 4003 with the version the server takes', async () => {
    const server = await fakeServer({ minRunnerVersion: '9.0.0' });
    const { link } = startLink(server.url);
    await server.frames.next('runner.resync');
    await server.closeAll(4003, 'runner too old');
    expect(await link.ended).toEqual({
      reason: 'too_old',
      code: 4003,
      hello: { type: 'server.hello', protocol: 1, minRunnerVersion: '9.0.0', machineId: server.machineId },
    });
  });

  it('stops reconnecting when a newer connection of the machine replaced it (4004)', async () => {
    const server = await fakeServer();
    const { link, time, delays } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4004, 'replaced');
    expect((await link.ended).reason).toBe('replaced');
    await time.advance(120_000);
    expect(delays()).toEqual([]);
    expect(server.connections).toHaveLength(1);
  });

  it('reconnects after a normal close and a hello timeout, and at the slowest pace for 4002', async () => {
    const server = await fakeServer();
    const { time, reconnectScheduled, logs } = startLink(server.url, { random: () => 0.5 });
    await server.frames.next('runner.heartbeat');
    await server.closeAll(1000, 'bye');
    expect(await reconnectScheduled(1)).toBe(1_100);
    expect(logs.entries.find((entry) => entry.msg === 'disconnected')).toMatchObject({
      code: 1000,
      reason: 'bye',
    });
    await time.advance(1_100);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4008);
    expect(await reconnectScheduled(2)).toBe(1_100);
    await time.advance(1_100);
    await server.frames.next('runner.heartbeat');
    await server.closeAll(4002, 'unsupported protocol');
    expect(await reconnectScheduled(3)).toBe(66_000);
  });
});

describe('stopping', () => {
  it('closes the socket with 1000 and never reconnects', async () => {
    const server = await fakeServer();
    const { link, time, delays } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    await link.stop();
    expect(await link.ended).toEqual({
      reason: 'stopped',
      code: 1000,
      hello: expect.objectContaining({ type: 'server.hello' }),
    });
    expect(link.connected).toBe(false);
    await time.advance(120_000);
    expect(delays()).toEqual([]);
    expect(server.openSockets).toBe(0);
    await link.stop();
  });

  it('stops at once while waiting to reconnect', async () => {
    const server = await fakeServer();
    const { link, time, reconnectScheduled } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    server.dropAll();
    await reconnectScheduled(1);
    await link.stop();
    expect((await link.ended).reason).toBe('stopped');
    expect(time.pending).toEqual([]);
  });

  it('stops while the upgrade is still in progress', async () => {
    const server = await fakeServer();
    const { link } = startLink(server.url);
    await link.stop();
    expect((await link.ended).reason).toBe('stopped');
    await settle();
    expect(server.frames.all).toEqual([]);
  });
});
