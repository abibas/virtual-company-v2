import type { Server } from 'node:http';
import { captureLogger } from '@mwc/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gracefulShutdown, SHUTDOWN_TIMEOUT_MS } from '../../src/platform/shutdown.ts';

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

  it('stops the jobs loop with the server, before the database closes', async () => {
    const order: string[] = [];
    let jobsDone = () => {};
    const shutdown = gracefulShutdown({
      server: fakeServer((callback) => {
        order.push('server closed');
        callback();
      }),
      stopJobs: () =>
        new Promise<void>((resolve) => {
          order.push('jobs stopping');
          jobsDone = () => {
            order.push('jobs stopped');
            resolve();
          };
        }),
      closeDb: async () => {
        order.push('db closed');
      },
      logger: captureLogger().logger,
      exit: (code) => order.push(`exit ${code}`),
    });
    const done = shutdown('SIGTERM');
    await vi.waitFor(() => expect(order).toEqual(['server closed', 'jobs stopping']));
    jobsDone();
    await done;
    expect(order).toEqual(['server closed', 'jobs stopping', 'jobs stopped', 'db closed', 'exit 0']);
  });

  it("ends the modules' work in memory (the sign-ins' sandboxes) before the database closes", async () => {
    const order: string[] = [];
    let killed = () => {};
    const shutdown = gracefulShutdown({
      server: fakeServer((callback) => callback()),
      stopModules: () =>
        new Promise<void>((resolve) => {
          order.push('sign-ins stopping');
          killed = () => {
            order.push('sandboxes killed');
            resolve();
          };
        }),
      closeDb: async () => {
        order.push('db closed');
      },
      logger: captureLogger().logger,
      exit: (code) => order.push(`exit ${code}`),
    });
    const done = shutdown('SIGTERM');
    await vi.waitFor(() => expect(order).toEqual(['sign-ins stopping']));
    killed();
    await done;
    expect(order).toEqual(['sign-ins stopping', 'sandboxes killed', 'db closed', 'exit 0']);
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
