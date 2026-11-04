import { identityOutbox, readJournal } from '@mwc/db';
import { migrateToLatest, queryRows, rawDb } from '@mwc/db/system';
import {
  brokenDb,
  createTestApp,
  fixedClock,
  getJson,
  LEVEL,
  seedCompany,
  TEST_VERSION,
  type TestApp,
} from '@mwc/testkit';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../src/modules/health/service.ts';
import { enqueueOutbox } from '../../../src/platform/jobs/outbox.ts';

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
      jobs: { enabled: false, holdsLock: false, lastTickAt: null, outbox: { due: 0, failed: 0 } },
    });
  });

  it("shows this process's jobs loop and the outbox backlog, and is ready whatever they say", async () => {
    const clock = fixedClock(Date.now() + 60_000);
    const status = { enabled: true, holdsLock: true, lastTickAt: new Date('2026-11-04T10:00:05Z') };
    t = await createTestApp({ clock, jobs: { status: () => status } });
    const scoped = (await seedCompany(t.db)).tenant;
    const row = (key: string) => enqueueOutbox(scoped, { op: 'invite', idempotencyKey: key });
    const [due, later, failed] = [await row('due'), await row('later'), await row('failed')];
    await rawDb(t.db)
      .update(identityOutbox)
      .set({ nextAttemptAt: new Date(clock().getTime() + 1000) })
      .where(eq(identityOutbox.id, later?.id ?? ''));
    await rawDb(t.db)
      .update(identityOutbox)
      .set({ status: 'failed' })
      .where(eq(identityOutbox.id, failed?.id ?? ''));
    expect(due).toBeDefined();
    const jobs = { enabled: true, holdsLock: true, lastTickAt: '2026-11-04T10:00:05.000Z' };
    expect(await getJson(t.app, '/readyz')).toMatchObject({
      status: 200,
      body: { status: 'ready', jobs: { ...jobs, outbox: { due: 1, failed: 1 } } },
    });
    // Another process runs the jobs, or none has ticked yet: still ready.
    Object.assign(status, { holdsLock: false, lastTickAt: null });
    expect(await getJson(t.app, '/readyz')).toMatchObject({
      status: 200,
      body: { jobs: { enabled: true, holdsLock: false, lastTickAt: null, outbox: { due: 1, failed: 1 } } },
    });
    clock.advance(1000);
    expect((await getJson(t.app, '/readyz')).body).toMatchObject({ jobs: { outbox: { due: 2, failed: 1 } } });
  });

  it('is ready with the outbox backlog unknown when it cannot be counted', async () => {
    t = await createTestApp();
    await queryRows(t.db, sql`alter table identity_outbox rename to identity_outbox_away`);
    try {
      expect(await getJson(t.app, '/readyz')).toMatchObject({
        status: 200,
        body: { status: 'ready', jobs: { enabled: false, outbox: null } },
      });
      const warn = t.logs.find((line) => line.msg === 'readyz: could not count the outbox backlog');
      expect(warn?.level).toBe(LEVEL.warn);
    } finally {
      await queryRows(t.db, sql`alter table identity_outbox_away rename to identity_outbox`);
    }
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

describe('GET /api/version', () => {
  it('answers the server and API versions', async () => {
    const t = await createTestApp({ db: brokenDb() });
    const res = await t.app.request('/api/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: TEST_VERSION, apiVersion: 1 });
  });
});
