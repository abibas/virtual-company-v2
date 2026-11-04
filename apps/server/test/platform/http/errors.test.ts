import { createRoute, z } from '@hono/zod-openapi';
import { createTestApp, LEVEL, type TestApp } from '@mwc/testkit';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorCode } from '../../../src/platform/http/errors.ts';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
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
    expect(err.stack).toContain('errors.test.ts');
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
