import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RunnerFrame, RunnerHello, ServerFrame } from '@mwc/shared/runner-protocol';
import { FakeRunnerServer, type FakeRunnerServerOptions } from '@mwc/testkit/runner';
import { vi } from 'vitest';
import { WebSocket } from 'ws';
import { Link, type LinkDeps } from '../../src/link/link.ts';
import { memoryLog } from './log.ts';
import { RUNNER_KEY } from './runner.ts';
import { FakeTime } from './time.ts';

export const HELLO: RunnerHello = {
  type: 'runner.hello',
  protocol: 1,
  version: '0.1.0',
  builtAt: null,
  caps: {
    harnesses: { claude_code: null, codex: null },
    slots: 1,
    hold: 'none',
    power: [],
    terminal: false,
    selfUpdate: false,
    folders: false,
    mkdirp: false,
    forks: true,
    reattach: false,
    agentTools: false,
    decisions: false,
    serverTools: false,
    github: false,
  },
};

const links: Link[] = [];
const servers: FakeRunnerServer[] = [];
const httpServers: Server[] = [];

export async function fakeServer(options: FakeRunnerServerOptions = {}): Promise<FakeRunnerServer> {
  const server = await FakeRunnerServer.start(options);
  servers.push(server);
  return server;
}

/** A server that refuses every upgrade with an HTTP status (401 for a bad key); its runner address. */
export async function refusingServer(status: number): Promise<string> {
  const http = createServer();
  http.on('upgrade', (_request, socket) => {
    socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  httpServers.push(http);
  return `ws://127.0.0.1:${(http.address() as AddressInfo).port}/api/runner/ws`;
}

/** A link on fake time with simple parts: it acks every command and refuses what it cannot read. */
export function startLink(url: string, overrides: Partial<LinkDeps> = {}) {
  const time = new FakeTime();
  const logs = memoryLog(() => time.now());
  const handled: ServerFrame[] = [];
  const link = new Link({
    url,
    key: () => RUNNER_KEY,
    WebSocket,
    clock: time,
    timers: time,
    random: () => 0,
    log: logs.log,
    hello: () => HELLO,
    afterHello: () => [
      { type: 'runner.resync', runs: [] },
      { type: 'hold.state', until: null, source: 'server' },
    ],
    beat: async (): Promise<RunnerFrame[]> => [
      { type: 'runner.heartbeat', awakeMs: time.mono, load1: 0, liveRuns: [], backlog: 0, now: time.now() },
    ],
    handle: async (frame) => {
      handled.push(frame);
      return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
    },
    refuse: (text, why) => {
      const { cmdId } = JSON.parse(text) as { cmdId?: string };
      return cmdId ? [{ type: 'cmd.ack', cmdId, ok: false, error: why }] : [];
    },
    ...overrides,
  });
  links.push(link);
  link.start();
  const delays = () =>
    logs.entries.filter((entry) => entry.msg === 'reconnecting').map((entry) => entry.inMs as number);
  /** Waits (real time) until the link has scheduled its `count`-th reconnect, and returns that delay. */
  const reconnectScheduled = async (count: number) => {
    await vi.waitFor(() => {
      if (delays().length < count) throw new Error(`waiting for reconnect ${count}`);
    });
    return delays()[count - 1] as number;
  };
  const connected = () =>
    vi.waitFor(() => {
      if (!link.connected) throw new Error('waiting for the handshake');
    });
  return { link, time, logs, handled, delays, reconnectScheduled, connected };
}

export async function cleanUpLinks(): Promise<void> {
  await Promise.all(links.splice(0).map((link) => link.stop()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    httpServers.splice(0).map(
      (http) =>
        new Promise<void>((resolve) => {
          http.close(() => resolve());
          http.closeAllConnections();
        }),
    ),
  );
}
