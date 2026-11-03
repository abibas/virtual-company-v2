import { createRoute, z } from '@hono/zod-openapi';
import { isId } from '@mwc/shared/ids';
import {
  brokenDb,
  createTestApp,
  fixedClock,
  LEVEL,
  TEST_NOW,
  TEST_VERSION,
  type TestApp,
} from '@mwc/testkit';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REQUEST_ID_MAX_LENGTH } from './app.ts';
import { errorCode } from './http/errors.ts';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ clock: fixedClock() });
  // Test-only routes, added after createApp the way a module router would be.
  t.app.get('/test/boom', () => {
    throw new Error('secret internals: password=hunter2');
  });
  t.app.get('/test/forbidden', () => {
    throw new HTTPException(403, { message: 'not yours' });
  });
  t.app.get('/test/teapot', () => {
    throw new HTTPException(418);
  });
  t.app.get('/test/clock', (c) => c.json({ now: c.var.clock().toISOString() }));
  t.app.openapi(
    createRoute({
      method: 'get',
      path: '/test/validated',
      request: { query: z.object({ n: z.coerce.number().int().min(1) }) },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: z.object({ n: z.number() }) } } },
      },
    }),
    (c) => c.json({ n: c.req.valid('query').n }, 200),
  );
});
afterAll(async () => {
  await t.close();
});

const logFor = (requestId: string | null) =>
  t.logs.filter((line) => line.msg === 'request' && line.requestId === requestId);

describe('request id', () => {
  it('generates a UUID v7 when none is sent and echoes it in the response header', async () => {
    const res = await t.app.request('/healthz');
    const id = res.headers.get('x-request-id');
    expect(id && isId(id)).toBe(true);
    expect(logFor(id)).toHaveLength(1);
  });

  it("keeps the caller's id when it is a sane token", async () => {
    const res = await t.app.request('/healthz', { headers: { 'x-request-id': 'trace-abc_123=' } });
    expect(res.headers.get('x-request-id')).toBe('trace-abc_123=');
  });

  it.each([
    ['spaces', 'two words'],
    ['a header injection attempt', 'abc\tdef'],
    ['punctuation', 'id;drop'],
    ['an overlong id', 'x'.repeat(REQUEST_ID_MAX_LENGTH + 1)],
  ])('replaces %s with a new id', async (_, incoming) => {
    const res = await t.app.request('/healthz', { headers: { 'x-request-id': incoming } });
    const id = res.headers.get('x-request-id');
    expect(id).not.toBe(incoming);
    expect(id && isId(id)).toBe(true);
  });

  it('is in the error body and the response header of an error', async () => {
    const res = await t.app.request('/nowhere', { headers: { 'x-request-id': 'req-404' } });
    expect(res.headers.get('x-request-id')).toBe('req-404');
    expect(((await res.json()) as { error: { requestId: string } }).error.requestId).toBe('req-404');
  });
});

describe('request log', () => {
  it('logs method, path without the query, status, duration and request id, but no headers', async () => {
    await t.app.request('/api/version?token=secret', {
      headers: { 'x-request-id': 'req-log', authorization: 'Bearer secret' },
    });
    const [line] = logFor('req-log');
    expect(line).toMatchObject({ level: LEVEL.info, method: 'GET', path: '/api/version', status: 200 });
    expect(typeof line?.durationMs).toBe('number');
    expect(JSON.stringify(line)).not.toContain('secret');
  });

  it('logs probes at debug, client errors at warn and server errors at error', async () => {
    await t.app.request('/healthz', { headers: { 'x-request-id': 'req-probe' } });
    await t.app.request('/nowhere', { headers: { 'x-request-id': 'req-miss' } });
    await t.app.request('/test/boom', { headers: { 'x-request-id': 'req-boom' } });
    expect(logFor('req-probe')[0]?.level).toBe(LEVEL.debug);
    expect(logFor('req-miss')[0]?.level).toBe(LEVEL.warn);
    expect(logFor('req-boom')[0]).toMatchObject({ level: LEVEL.error, status: 500 });
  });
});

describe('errors', () => {
  it('answers 500 without internals and logs the error with its stack', async () => {
    const res = await t.app.request('/test/boom', { headers: { 'x-request-id': 'req-500' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal server error', requestId: 'req-500' },
    });
    expect(text).not.toContain('hunter2');
    const logged = t.logs.find((line) => line.msg === 'request failed' && line.requestId === 'req-500');
    expect(logged?.level).toBe(LEVEL.error);
    const err = logged?.err as { message: string; stack: string };
    expect(err.message).toContain('secret internals');
    expect(err.stack).toContain('app.test.ts');
  });

  it('keeps the status and message of a client error', async () => {
    const res = await t.app.request('/test/forbidden');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: object }).error).toMatchObject({
      code: 'forbidden',
      message: 'not yours',
    });
  });

  it('gives an unmapped client error the generic code and a default message', async () => {
    const res = await t.app.request('/test/teapot');
    expect(res.status).toBe(418);
    expect(((await res.json()) as { error: object }).error).toMatchObject({
      code: 'error',
      message: 'Request failed',
    });
    expect(errorCode(404)).toBe('not_found');
  });

  it('answers an unknown route with a JSON 404', async () => {
    const res = await t.app.request('/api/nope', { method: 'POST', headers: { 'x-request-id': 'req-nf' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'No route for POST /api/nope', requestId: 'req-nf' },
    });
  });

  it('answers invalid input with a 400 in the same shape', async () => {
    const res = await t.app.request('/test/validated?n=zero');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('n');
    expect((await t.app.request('/test/validated?n=2')).status).toBe(200);
  });
});

describe('GET /api/version', () => {
  it('answers the server and API versions', async () => {
    const res = await t.app.request('/api/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: TEST_VERSION, apiVersion: 1 });
  });
});

describe('OpenAPI and docs', () => {
  it('serves an OpenAPI 3.1 document that lists the routes', async () => {
    const res = await t.app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { version: string };
      paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(TEST_VERSION);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/healthz', '/readyz', '/api/version']));
    expect(Object.keys(doc.paths['/readyz']?.get?.responses ?? {})).toEqual(['200', '503']);
  });

  it('serves the Swagger UI page with its assets from this server, not a CDN', async () => {
    const res = await t.app.request('/api/docs');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/api/openapi.json');
    expect(html).toContain('/api/docs/assets/swagger-ui-dist/swagger-ui-bundle.js');
    expect(html).not.toMatch(/https?:\/\//);

    const css = await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui-bundle.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect((await js.arrayBuffer()).byteLength).toBeGreaterThan(100_000);
    // A second request comes from the cache.
    expect((await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui.css')).status).toBe(200);
  });

  it('serves only the listed asset files', async () => {
    for (const file of ['package.json', 'index.html', '..%2F..%2Fpackage.json']) {
      expect((await t.app.request(`/api/docs/assets/swagger-ui-dist/${file}`)).status).toBe(404);
    }
  });
});

describe('clock', () => {
  it('gives routes the injected clock', async () => {
    const res = await t.app.request('/test/clock');
    expect(await res.json()).toEqual({ now: TEST_NOW });
  });

  it('defaults to the system clock', async () => {
    const plain = await createTestApp({ db: brokenDb() });
    plain.app.get('/test/clock', (c) => c.json({ now: c.var.clock().getTime() }));
    const before = Date.now();
    const { now } = (await (await plain.app.request('/test/clock')).json()) as { now: number };
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
