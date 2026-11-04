import { createTestApp, LEVEL, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  t.app.get('/test/boom', () => {
    throw new Error('boom');
  });
});
afterAll(async () => {
  await t.close();
});

const logFor = (requestId: string | null) =>
  t.logs.filter((line) => line.msg === 'request' && line.requestId === requestId);

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
