import { migrateToLatest, readJournal } from '@mwc/db';
import { brokenDb, createTestApp, getJson, LEVEL, TEST_VERSION, type TestApp } from '@mwc/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from './routes/health.ts';

// readJournal as a pass-through spy, to see how often the server reads the journal file.
vi.mock('@mwc/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mwc/db')>();
  return { ...actual, readJournal: vi.fn(actual.readJournal) };
});

const journal = readJournal();

describe('GET /healthz', () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it('answers 200 with the version', async () => {
    t = await createTestApp();
    expect(await getJson(t.app, '/healthz')).toMatchObject({
      status: 200,
      body: { status: 'ok', version: TEST_VERSION },
    });
  });

  it('never touches the database (still 200 when it is down)', async () => {
    t = await createTestApp({ db: brokenDb() });
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

  it('reads the migration journal once, when the app is built, never per request', async () => {
    vi.mocked(readJournal).mockClear();
    t = await createTestApp();
    expect(readJournal).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) expect((await getJson(t.app, '/readyz')).status).toBe(200);
    expect(readJournal).toHaveBeenCalledOnce();
  });

  it('compares against the journal it is given', async () => {
    vi.mocked(readJournal).mockClear();
    const ahead = [...journal, { idx: journal.length, tag: '9999_next', when: Date.now() + 60_000 }];
    t = await createTestApp({ journal: ahead });
    expect(readJournal).not.toHaveBeenCalled();
    expect(await getJson(t.app, '/readyz')).toMatchObject({
      status: 503,
      body: {
        status: 'not_ready',
        reason: `migrations behind: ${journal.length} of ${ahead.length} applied`,
      },
    });
  });

  it('is 503 when the database query throws, without leaking the driver error', async () => {
    t = await createTestApp({ db: brokenDb() });
    const res = await t.app.request('/readyz');
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'not_ready', reason: 'database unreachable' });
    expect(text).not.toContain('hunter2');
    const warn = t.logs.find((line) => line.msg === 'readyz: database unreachable');
    expect(warn?.level).toBe(LEVEL.warn);
    expect(JSON.stringify(warn?.err)).toContain('ECONNREFUSED');
    // A failing probe is a warning in the request log, not an error.
    expect(t.logs.find((line) => line.msg === 'request')).toMatchObject({ status: 503, level: LEVEL.warn });
  });

  it('is 503 when the database does not answer in time', async () => {
    vi.useFakeTimers();
    t = await createTestApp({ db: brokenDb('hang') });
    const pending = t.app.request('/readyz');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'not_ready', reason: 'database timed out' });
    expect(t.logs.some((line) => line.msg === 'readyz: database timed out')).toBe(true);
  });
});
