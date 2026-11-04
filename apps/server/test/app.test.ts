import { isCompanyNotFound } from '@mwc/db';
import { IdentityOutboxOp } from '@mwc/shared/enums';
import { isId } from '@mwc/shared/ids';
import {
  brokenDb,
  createTestApp,
  FakeIdentityProvider,
  fixedClock,
  TEST_NOW,
  type TestApp,
  testConfig,
} from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moduleJobs, REQUEST_ID_MAX_LENGTH } from '../src/app.ts';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ clock: fixedClock() });
  // A test-only route, added after createApp the way a module router would be.
  t.app.get('/test/clock', (c) => c.json({ now: c.var.clock().toISOString() }));
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

describe('moduleJobs', () => {
  it("gives the jobs loop one handler for every outbox op, the identity module's event retry and reconcile", async () => {
    const deps = { db: t.db, config: testConfig, logger: t.logger, version: 'test', clock: fixedClock() };
    const jobs = moduleJobs({ ...deps, identity: new FakeIdentityProvider() });
    expect(Object.keys(jobs.outboxHandlers).sort()).toEqual([...IdentityOutboxOp.options].sort());
    expect(await jobs.retryEvents()).toEqual({ claimed: 0, processed: 0, failed: 0, givenUp: 0 });
    const missing = jobs.reconcileCompany('019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f');
    await expect(missing).rejects.toSatisfy(isCompanyNotFound);
  });
});
