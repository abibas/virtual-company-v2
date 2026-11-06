import { newId } from '@mwc/shared/ids';
import { RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { FakeRunner, FakeRunnerServer, type FakeRunnerServerOptions } from '../../src/runner.ts';

const servers: FakeRunnerServer[] = [];
const runners: FakeRunner[] = [];

async function startServer(options: FakeRunnerServerOptions = {}): Promise<FakeRunnerServer> {
  const server = await FakeRunnerServer.start(options);
  servers.push(server);
  return server;
}

async function connectRunner(server: FakeRunnerServer, key?: string): Promise<FakeRunner> {
  const runner = new FakeRunner({ url: server.url, ...(key === undefined ? {} : { key }) });
  runners.push(runner);
  await runner.connect();
  return runner;
}

/** A bare client, for what a well-behaved runner never does. */
function rawClient(url: string, protocols?: string | string[]): Promise<WebSocket> {
  const socket = new WebSocket(url, protocols);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.disconnect()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('FakeRunnerServer', () => {
  it('listens on 127.0.0.1 at the runner path and answers runner.hello with server.hello', async () => {
    const machineId = newId();
    const server = await startServer({ machineId, minRunnerVersion: '0.5.0' });
    expect(server.url).toBe(`ws://127.0.0.1:${server.port}/api/runner/ws`);
    expect(server.port).toBeGreaterThan(0);
    const runner = await connectRunner(server, 'mwc_rk_test');
    expect(await runner.frames.next('server.hello')).toEqual({
      type: 'server.hello',
      protocol: 1,
      minRunnerVersion: '0.5.0',
      machineId,
    });
    expect(server.connections).toEqual([
      { authorization: 'Bearer mwc_rk_test', protocol: RUNNER_SUBPROTOCOL },
    ]);
    expect((await server.frames.next('runner.hello')).version).toBe('1.0.0');
    expect(server.openSockets).toBe(1);
  });

  it('makes up a machine id and takes any runner version by default', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    const hello = await runner.frames.next('server.hello');
    expect(hello).toMatchObject({ machineId: server.machineId, minRunnerVersion: '0.0.0' });
    expect(server.connections[0]?.authorization).toBeUndefined();
  });

  it('can leave a runner waiting for its hello', async () => {
    const server = await startServer({ hello: false });
    const socket = await rawClient(server.url, RUNNER_SUBPROTOCOL);
    const replies: string[] = [];
    socket.on('message', (data) => replies.push(String(data)));
    socket.send(JSON.stringify(new FakeRunner({ url: server.url }).hello));
    await server.frames.next('runner.hello');
    socket.send(JSON.stringify({ type: 'runner.resync', runs: [] }));
    await server.frames.next('runner.resync');
    expect(replies).toEqual([]);
    socket.terminate();
  });

  it('records unknown and invalid frames apart from the frames', async () => {
    const server = await startServer();
    const socket = await rawClient(server.url, RUNNER_SUBPROTOCOL);
    socket.send('{"type":"runner.future"}');
    socket.send('not json');
    socket.send(JSON.stringify({ type: 'cmd.ack', cmdId: newId(), ok: true }));
    await server.frames.next('cmd.ack');
    expect(server.unknown).toEqual(['runner.future']);
    expect(server.invalid.map((error) => error.code)).toEqual(['not_json']);
    expect(server.frames.all.map((frame) => frame.type)).toEqual(['cmd.ack']);
    socket.terminate();
  });

  it('agrees on no subprotocol with a client that offers none, and only takes its own path', async () => {
    const server = await startServer();
    const bare = await rawClient(server.url);
    expect(bare.protocol).toBe('');
    await expect(rawClient(server.url, 'other.v1')).rejects.toThrow('Server sent no subprotocol');
    await expect(rawClient(server.url.replace('/api/runner/ws', '/api/other'))).rejects.toThrow('400');
    bare.terminate();
  });

  it('sends frames and raw texts to every open socket', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    expect(server.send({ type: 'run.ack', runId: newId(), ackedSeq: 4 })).toBe(1);
    expect((await runner.frames.next('run.ack')).ackedSeq).toBe(4);
    expect(server.sendRaw('{"type":"server.future"}')).toBe(1);
    await expect.poll(() => runner.unknown).toEqual(['server.future']);
  });

  it('drops every socket at once and keeps listening', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    server.dropAll();
    expect(await runner.closed()).toEqual({ code: 1006, reason: '' });
    expect(server.openSockets).toBe(0);
    expect(server.send({ type: 'runner.drain', cmdId: newId() })).toBe(0);
    await runner.connect();
    expect(server.connections).toHaveLength(2);
    expect(server.frames.of('runner.hello')).toHaveLength(2);
  });

  it('closes every socket with a close code, and pings every socket until it answers', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    // The pong (ws answers by itself) proves the ping arrived.
    expect(await server.ping()).toBe(1);
    await server.closeAll(4004, 'replaced');
    expect(await runner.closed()).toEqual({ code: 4004, reason: 'replaced' });
    expect(server.openSockets).toBe(0);
    expect(await server.ping()).toBe(0);
    await expect(server.closeAll(4001)).resolves.toBeUndefined();
  });

  it('stops, refusing connections, and starts again on the same port', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    const port = server.port;
    await server.stop();
    expect((await runner.closed()).code).toBe(1006);
    await expect(runner.connect()).rejects.toThrow('ECONNREFUSED');
    await server.stop();
    await server.start();
    await server.start();
    expect(server.port).toBe(port);
    await runner.connect();
    expect(runner.connected).toBe(true);
  });

  it('restarts: every runner is cut off and can come back to the same address', async () => {
    const server = await startServer();
    const runner = await connectRunner(server);
    await server.restart();
    expect((await runner.closed()).code).toBe(1006);
    const hello = await runner.reconnect();
    expect(hello.machineId).toBe(server.machineId);
    expect(server.connections).toHaveLength(2);
  });
});
