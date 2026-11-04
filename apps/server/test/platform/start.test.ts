import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationStatus } from '@mwc/db';
import { createPgliteDb } from '@mwc/db/pglite';
import { type PostgresDbHandle, rawHandle } from '@mwc/db/system';
import { ConfigError } from '@mwc/shared/config';
import { captureLogger, getJson, LEVEL } from '@mwc/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Serve, type StartDeps, start } from '../../src/platform/start.ts';
import { readServerVersion } from '../../src/platform/version.ts';

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://mwc:mwc@127.0.0.1:9999/mwc' };

/** A server that never listens: it records the options, says it is listening, and closes on request. */
function fakeServe() {
  const server = Object.assign(new EventEmitter(), {
    close: vi.fn((callback: (error?: Error) => void) => callback()),
    closeIdleConnections: vi.fn(),
  });
  const calls: Parameters<Serve>[0][] = [];
  const serveFake: Serve = (options, onListening) => {
    calls.push(options);
    onListening({ port: options.port, address: options.hostname, family: 'IPv4' });
    return server as unknown as Server;
  };
  return { serve: serveFake, server, calls };
}

/** Test dependencies: a capture logger, a fake server, recorded signals and exits, PGlite by default. */
function testDeps(overrides: Partial<StartDeps> = {}) {
  const { logger, lines } = captureLogger();
  const fake = fakeServe();
  const signals = new Map<string, (signal: string) => void>();
  const exit = vi.fn();
  const deps: Partial<StartDeps> = {
    createLogger: async () => logger,
    readVersion: () => '1.2.3-test',
    openDb: () => createPgliteDb(),
    serve: fake.serve,
    onSignal: (signal, handler) => signals.set(signal, handler),
    exit,
    ...overrides,
  };
  return { deps, lines, fake, signals, exit };
}

/** A port nothing listens on right now (the system's pick for port 0). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

describe('start', () => {
  it('refuses an invalid configuration before it opens the database or listens', async () => {
    const t = testDeps({ openDb: vi.fn(() => createPgliteDb()) });
    const failure = start({ NODE_ENV: 'test' }, t.deps);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(/DATABASE_URL/);
    expect(t.deps.openDb).not.toHaveBeenCalled();
    expect(t.fake.calls).toEqual([]);
  });

  it('builds the app on the database and listens where the configuration says', async () => {
    const t = testDeps();
    const started = await start({ ...ENV, MWC_PORT: '9961', MWC_HOST: '0.0.0.0' }, t.deps);
    open.push(started.db);
    expect(t.fake.calls).toEqual([{ fetch: started.app.fetch, port: 9961, hostname: '0.0.0.0' }]);
    expect(t.lines.find((line) => line.msg === 'listening')).toMatchObject({
      level: LEVEL.info,
      host: '0.0.0.0',
      port: 9961,
      version: '1.2.3-test',
      db: 'postgres',
      identity: 'none',
    });
    expect(started.config.MWC_PORT).toBe(9961);
    expect(await getJson(started.app, '/healthz')).toMatchObject({
      status: 200,
      body: { status: 'ok', version: '1.2.3-test' },
    });
    // Not migrated: MWC_MIGRATE_ON_START is off by default.
    expect((await getJson(started.app, '/readyz')).status).toBe(503);
  });

  it('applies the migrations first with MWC_MIGRATE_ON_START, or when the caller asks', async () => {
    for (const [env, migrate] of [
      [{ ...ENV, MWC_MIGRATE_ON_START: 'true' }, false],
      [ENV, true],
    ] as const) {
      const t = testDeps({ migrate });
      const started = await start(env, t.deps);
      open.push(started.db);
      expect((await migrationStatus(started.db)).current).toBe(true);
      expect(t.lines.some((line) => line.msg === 'applying migrations')).toBe(true);
      expect((await getJson(started.app, '/readyz')).status).toBe(200);
    }
  });

  it('serves the built UI from MWC_WEB_DIST', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'mwc-start-dist-'));
    try {
      writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Most Wanted Corp</title>');
      const started = await start({ ...ENV, MWC_WEB_DIST: dist }, testDeps().deps);
      open.push(started.db);
      const res = await started.app.request('/');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>Most Wanted Corp</title>');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('shuts down gracefully on SIGTERM and SIGINT, and exits 1 on a server error', async () => {
    const t = testDeps();
    const started = await start(ENV, t.deps);
    expect([...t.signals.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    expect(t.signals.get('SIGTERM')).toBe(started.shutdown);

    t.fake.server.emit('error', new Error('listen EADDRINUSE: address already in use'));
    expect(t.exit).toHaveBeenCalledWith(1);
    expect(t.lines.find((line) => line.msg === 'server error')?.level).toBe(LEVEL.fatal);

    t.exit.mockClear();
    await t.signals.get('SIGINT')?.('SIGINT');
    expect(t.fake.server.close).toHaveBeenCalledOnce();
    expect(t.exit).toHaveBeenCalledWith(0);
    // The database is closed: a query on it fails now.
    await expect(migrationStatus(started.db)).rejects.toThrow();
  });

  it('uses the system defaults: createDb, the configured logger, the package version, serve() and process signals', async () => {
    const port = await freePort();
    const exit = vi.fn();
    const started = await start(
      { ...ENV, NODE_ENV: 'production', MWC_LOG_LEVEL: 'fatal', MWC_PORT: String(port) },
      { exit },
    );
    try {
      expect(process.listeners('SIGTERM')).toContain(started.shutdown);
      expect(process.listeners('SIGINT')).toContain(started.shutdown);
      expect(started.db.driver).toBe('postgres-js');
      expect(started.logger.level).toBe('fatal');
      expect(started.version).toBe(readServerVersion());
      // Postgres notices go to the logger at debug (below fatal here, so nothing is printed).
      const db = rawHandle(started.db) as PostgresDbHandle;
      const { onnotice } = db.db.$client.options as { onnotice?: (notice: object) => void };
      expect(() => onnotice?.({ message: 'schema exists, skipping', code: '42P06' })).not.toThrow();

      // A real listening server: /healthz never touches the database (nothing listens on its port).
      if (!started.server.listening)
        await new Promise((resolve) => started.server.once('listening', resolve));
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBeTruthy();
      expect(await res.json()).toMatchObject({ status: 'ok' });

      await started.shutdown('SIGTERM');
      expect(exit).toHaveBeenCalledWith(0);
      expect(started.server.listening).toBe(false);
    } finally {
      process.removeListener('SIGTERM', started.shutdown);
      process.removeListener('SIGINT', started.shutdown);
    }
  });
});
