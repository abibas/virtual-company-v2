import { describe, expect, it } from 'vitest';
import {
  brokenDb,
  captureLogger,
  createTestApp,
  FAKE_ISSUER,
  FAKE_SIGNATURE_HEADER,
  FakeIdentityProvider,
  fixedClock,
  getJson,
  InMemoryIdentityStore,
  LEVEL,
  postJson,
  requestJson,
  TEST_NOW,
  TEST_VERSION,
} from './index.ts';

describe('captureLogger', () => {
  it('keeps every line from debug up, parsed, and prints nothing', () => {
    const { logger, lines } = captureLogger();
    logger.trace('hidden');
    logger.debug({ n: 1 }, 'first');
    logger.error('second');
    expect(lines.map((line) => [line.level, line.msg])).toEqual([
      [LEVEL.debug, 'first'],
      [LEVEL.error, 'second'],
    ]);
    expect(lines[0]?.n).toBe(1);
  });
});

describe('identity test doubles', () => {
  it('re-exports the fake identity provider and the in-memory identity store', async () => {
    const fake = new FakeIdentityProvider({ clock: fixedClock() });
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    expect(await fake.verifyAccessToken('fake:u1;pending', { authorizedParties: [] })).toMatchObject({
      issuer: FAKE_ISSUER,
      subject: 'u1',
      pending: true,
    });
    const [event] = fake.drainEvents();
    expect(event?.occurredAt).toBe(Date.parse(TEST_NOW));
    if (event) expect(fake.webhookFor(event).headers[FAKE_SIGNATURE_HEADER]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(new InMemoryIdentityStore().snapshot().users).toEqual([]);
  });
});

describe('fixedClock', () => {
  it('stands still at TEST_NOW by default and moves only when told', () => {
    const clock = fixedClock();
    expect(clock().toISOString()).toBe(TEST_NOW);
    expect(clock()).not.toBe(clock());
    clock.advance(90_000);
    expect(clock().toISOString()).toBe('2026-11-03T12:01:30.000Z');
    clock.set('2027-01-01T00:00:00Z');
    expect(clock().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('refuses a value that is not a time', () => {
    expect(() => fixedClock('soon')).toThrow(/not a time/);
  });
});

describe('createTestApp', () => {
  it('builds the app on a fresh, migrated test database with a capture logger', async () => {
    const t = await createTestApp();
    try {
      const ready = await getJson<{ status: string; version: string }>(t.app, '/readyz');
      expect(ready.status).toBe(200);
      expect(ready.body).toMatchObject({ status: 'ready', version: TEST_VERSION });
      expect(t.logs.some((line) => line.msg === 'request' && line.path === '/readyz')).toBe(true);
      t.logger.info('from the test');
      expect(t.logs.at(-1)?.msg).toBe('from the test');
    } finally {
      await t.close();
      await t.close();
    }
  });

  it('leaves the database unmigrated with migrate: false, and gives routes a fixed clock', async () => {
    const clock = fixedClock();
    const t = await createTestApp({ migrate: false, clock });
    try {
      t.app.get('/test/now', (c) => c.json({ now: c.var.clock().toISOString() }));
      expect((await getJson(t.app, '/test/now')).body).toEqual({ now: TEST_NOW });
      clock.advance(1000);
      expect((await getJson(t.app, '/test/now')).body).toEqual({ now: '2026-11-03T12:00:01.000Z' });
      expect((await getJson(t.app, '/readyz')).status).toBe(503);
    } finally {
      await t.close();
    }
  });

  it('uses a db and a logger passed in as they are', async () => {
    const { logger, lines } = captureLogger();
    const db = brokenDb();
    const t = await createTestApp({ db, logger });
    expect(t.db).toBe(db);
    expect(t.logger).toBe(logger);
    expect((await getJson(t.app, '/readyz')).status).toBe(503);
    expect(t.logs).toEqual([]);
    expect(lines.some((line) => line.msg === 'readyz: database unreachable')).toBe(true);
    await t.close();
  });
});

describe('JSON request helpers', () => {
  const app = {
    request: async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (path === '/empty') return new Response(null, { status: 204 });
      if (path === '/text') return new Response('plain words', { status: 200 });
      return Response.json(
        {
          method: init?.method,
          contentType: headers.get('content-type'),
          auth: headers.get('authorization'),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        },
        { status: 201, headers: { 'x-seen': path } },
      );
    },
  };

  it('posts JSON with headers and parses the answer', async () => {
    const res = await postJson(app, '/things', { name: 'x' }, { authorization: 'Bearer t' });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-seen')).toBe('/things');
    expect(res.body).toEqual({
      method: 'POST',
      contentType: 'application/json',
      auth: 'Bearer t',
      body: { name: 'x' },
    });
  });

  it('gets without a body, returns text as text and an empty body as null', async () => {
    expect((await getJson(app, '/things')).body).toMatchObject({
      method: 'GET',
      contentType: null,
      body: null,
    });
    expect((await getJson(app, '/text')).body).toBe('plain words');
    expect(await requestJson(app, 'DELETE', '/empty')).toMatchObject({ status: 204, body: null });
  });
});
