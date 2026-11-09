import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { captureLogger, getJson } from '@mwc/testkit';
import { describe, expect, it, vi } from 'vitest';
import { MEMORY_DATABASE_URL, startMemoryServer } from '../../src/dev/memory-server.ts';

describe('startMemoryServer', () => {
  it('serves the API on a migrated in-memory PGlite, whatever DATABASE_URL says', async () => {
    const { logger, lines } = captureLogger();
    const server = Object.assign(new EventEmitter(), {
      close: (callback: (error?: Error) => void) => callback(),
      closeIdleConnections: () => {},
    });
    const exit = vi.fn();
    const started = await startMemoryServer(
      { NODE_ENV: 'test', DATABASE_URL: 'postgres://someone@db.example/elsewhere', MWC_LOCAL_POWER: 'off' },
      {
        createLogger: async () => logger,
        serve: (options, onListening) => {
          onListening({ port: options.port, address: options.hostname, family: 'IPv4' });
          return server as unknown as Server;
        },
        onSignal: () => {},
        exit,
      },
    );
    expect(started.config.DATABASE_URL).toBe(MEMORY_DATABASE_URL);
    expect(started.db.driver).toBe('pglite');
    expect(await getJson(started.app, '/readyz')).toMatchObject({ status: 200, body: { status: 'ready' } });
    expect(lines.find((line) => line.msg === 'listening')).toMatchObject({
      port: 9950,
      host: '127.0.0.1',
      db: 'pglite (memory)',
    });

    await started.shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(0);
  });
});
