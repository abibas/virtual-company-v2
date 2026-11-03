import { migrateToLatest, readJournal } from '@mwc/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from './routes/health.ts';
import { brokenDb, createTestApp, LEVEL, TEST_VERSION, type TestApp } from './test-helpers.ts';

const journal = readJournal();

describe('GET /healthz', () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it('answers 200 with the version', async () => {
    t = await createTestApp();
    const res = await t.app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: TEST_VERSION });
  });

  it('never touches the database (still 200 when it is down)', async () => {
    t = await createTestApp({ deps: { db: brokenDb() } });
    expect((await t.app.request('/healthz')).status).toBe(200);
  });
});

describe('GET /readyz', () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await t?.close();
    t = undefined;
  });

  it('is 503 before the migrations run, with a reason that names them', async () => {
    t = await createTestApp({ migrate: false });
    const res = await t.app.request('/readyz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      reason: `migrations behind: 0 of ${journal.length} applied`,
    });
  });

  it('is 200 after migrateToLatest, with the migration counts and the last tag', async () => {
    t = await createTestApp({ migrate: false });
    await migrateToLatest(t.db);
    const res = await t.app.request('/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ready',
      version: TEST_VERSION,
      db: 'ok',
      migrations: { applied: journal.length, expected: journal.length, last: journal.at(-1)?.tag },
    });
  });

  it('is 503 when the database query throws, without leaking the driver error', async () => {
    t = await createTestApp({ deps: { db: brokenDb() } });
    const res = await t.app.request('/readyz');
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'not_ready', reason: 'database unreachable' });
    expect(text).not.toContain('hunter2');
    const warn = t.lines.find((line) => line.msg === 'readyz: database unreachable');
    expect(warn?.level).toBe(LEVEL.warn);
    expect(JSON.stringify(warn?.err)).toContain('ECONNREFUSED');
    // A failing probe is a warning in the request log, not an error.
    expect(t.lines.find((line) => line.msg === 'request')).toMatchObject({ status: 503, level: LEVEL.warn });
  });

  it('is 503 when the database does not answer in time', async () => {
    vi.useFakeTimers();
    t = await createTestApp({ deps: { db: brokenDb('hang') } });
    const pending = t.app.request('/readyz');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'not_ready', reason: 'database timed out' });
    expect(t.lines.some((line) => line.msg === 'readyz: database timed out')).toBe(true);
  });
});
