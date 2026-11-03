import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gracefulShutdown, SHUTDOWN_TIMEOUT_MS } from './shutdown.ts';
import { captureLogger, createTestApp } from './test-helpers.ts';

function fakeServer(close: (callback: (error?: Error) => void) => void) {
  return { close: vi.fn(close), closeIdleConnections: vi.fn() } as unknown as Server;
}

describe('gracefulShutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the server, then the database, then exits 0; a second signal is ignored', async () => {
    const order: string[] = [];
    const exit = vi.fn((code: number) => order.push(`exit ${code}`));
    const server = fakeServer((callback) => {
      order.push('server closed');
      callback();
    });
    const shutdown = gracefulShutdown({
      server,
      closeDb: async () => {
        order.push('db closed');
      },
      logger: captureLogger().logger,
      exit,
    });
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(order).toEqual(['server closed', 'db closed', 'exit 0']);
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
  });

  it('exits 1 when closing fails', async () => {
    const exit = vi.fn();
    const { logger, lines } = captureLogger();
    const shutdown = gracefulShutdown({
      server: fakeServer((callback) => callback(new Error('not running'))),
      closeDb: async () => {},
      logger,
      exit,
    });
    await shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.some((line) => line.msg === 'shutdown failed')).toBe(true);
  });

  it('exits 1 when the shutdown takes longer than the timeout', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = gracefulShutdown({
      server: fakeServer(() => {}), // a request that never finishes
      closeDb: async () => {},
      logger: captureLogger().logger,
      exit,
    });
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('serve() with createApp', () => {
  it('answers /healthz over HTTP on an ephemeral port, then shuts down gracefully', async () => {
    const t = await createTestApp();
    const server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: t.app.fetch, port: 0, hostname: '127.0.0.1' }, () =>
        resolve(s as Server),
      ) as Server;
    });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(await res.json()).toMatchObject({ status: 'ok' });

    const exit = vi.fn();
    await gracefulShutdown({ server, closeDb: t.close, logger: captureLogger().logger, exit })('SIGTERM');
    expect(exit).toHaveBeenCalledWith(0);
    expect(server.listening).toBe(false);
  });
});
