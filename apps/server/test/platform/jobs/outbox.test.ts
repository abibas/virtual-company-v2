import { companies, type IdentityOutboxRow, identityOutbox, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import {
  brokenDb,
  captureLogger,
  createTestApp,
  FakeIdentityProvider,
  fixedClock,
  seedCompany,
  type TestApp,
} from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  describeFailure,
  enqueueOutbox,
  isLastAttempt,
  OUTBOX_ERROR_LENGTH,
  OUTBOX_FIRST_DELAY_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_DELAY_MS,
  OutboxGiveUpError,
  outboxKey,
  outboxProvider,
  outboxTenant,
  processOutboxRow,
  retryDelayMs,
} from '../../../src/platform/jobs/outbox.ts';

const clock = fixedClock();
let t: TestApp;
let companyId: string;
beforeAll(async () => {
  t = await createTestApp({ clock });
  companyId = (await seedCompany(t.db)).company.id;
});
afterAll(() => t.close());

let seq = 0;
/** A new pending row of the seeded company (or with `values` patched in). */
async function newRow(values: Partial<IdentityOutboxRow> = {}): Promise<IdentityOutboxRow> {
  const scoped = await tenant(t.db, companyId);
  const row = await enqueueOutbox(scoped, {
    op: 'invite',
    idempotencyKey: outboxKey('invite', `row-${++seq}`),
  });
  if (Object.keys(values).length === 0) return row as IdentityOutboxRow;
  const [patched] = await rawDb(t.db)
    .update(identityOutbox)
    .set(values)
    .where(eq(identityOutbox.id, row?.id ?? ''))
    .returning();
  return patched as IdentityOutboxRow;
}
const reread = async (id: string) =>
  (await rawDb(t.db).select().from(identityOutbox).where(eq(identityOutbox.id, id)))[0];

describe('outboxKey, retryDelayMs and describeFailure', () => {
  it('keys a call by its op and what it is about', () => {
    expect(outboxKey('create_org', 'c1')).toBe('create_org:c1');
    expect(outboxKey('invite', 'c1', 'i1')).toBe('invite:c1:i1');
  });

  it('doubles the delay from 30 s up to an hour, unless the provider asked for longer', () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(0)).toBe(OUTBOX_FIRST_DELAY_MS);
    expect(retryDelayMs(20)).toBe(OUTBOX_MAX_DELAY_MS);
    expect(retryDelayMs(1, 5_000)).toBe(30_000);
    expect(retryDelayMs(1, 7_200_000)).toBe(7_200_000);
  });

  it("says a provider error's code and message, an error's message or the value, cut short", () => {
    expect(describeFailure(new IdentityProviderError('conflict', 'slug taken'))).toBe('conflict: slug taken');
    expect(describeFailure(new Error('plain'))).toBe('plain');
    expect(describeFailure('a string')).toBe('a string');
    expect(describeFailure(new Error('x'.repeat(900)))).toHaveLength(OUTBOX_ERROR_LENGTH);
  });
});

describe('enqueueOutbox', () => {
  it("adds a pending row in the tenant's company, once per idempotency key", async () => {
    const scoped = await tenant(t.db, companyId);
    const entry = {
      op: 'delete_org',
      idempotencyKey: outboxKey('delete_org', 'once'),
      payload: { a: 1 },
    } as const;
    const first = await enqueueOutbox(scoped, entry);
    expect(first).toMatchObject({
      companyId,
      op: 'delete_org',
      payload: { a: 1 },
      status: 'pending',
      attempts: 0,
    });
    expect(await enqueueOutbox(scoped, { ...entry, payload: { a: 2 } })).toBeUndefined();
    const rows = await rawDb(t.db)
      .select()
      .from(identityOutbox)
      .where(eq(identityOutbox.idempotencyKey, entry.idempotencyKey));
    expect(rows.map((row) => row.payload)).toEqual([{ a: 1 }]);
    expect((await enqueueOutbox(scoped, { op: 'invite', idempotencyKey: 'no-payload' }))?.payload).toEqual(
      {},
    );
  });
});

describe('processOutboxRow', () => {
  it('marks a row done when its handler resolves', async () => {
    const row = await newRow({ lastError: 'earlier failure', attempts: 2 });
    const handler = vi.fn(async () => undefined);
    expect(await processOutboxRow({ db: t.db, clock }, row, handler)).toBe('done');
    expect(handler).toHaveBeenCalledWith(row);
    expect(await reread(row.id)).toMatchObject({
      status: 'done',
      attempts: 3,
      completedAt: clock(),
      lastError: null,
    });
  });

  it('keeps a failed row pending with the try counted, the error and a later next try, and logs it', async () => {
    const { logger, lines } = captureLogger();
    const row = await newRow();
    const fail = async () => {
      throw new IdentityProviderError('unavailable', 'provider down');
    };
    expect(await processOutboxRow({ db: t.db, clock, logger }, row, fail)).toBe('retry');
    const once = await reread(row.id);
    expect(once).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'unavailable: provider down',
      nextAttemptAt: new Date(clock().getTime() + 30_000),
      completedAt: null,
    });
    expect(lines.at(-1)).toMatchObject({
      msg: 'identity outbox call failed',
      outboxId: row.id,
      attempts: 1,
      failed: false,
    });
    expect(await processOutboxRow({ db: t.db, clock }, once as IdentityOutboxRow, fail)).toBe('retry');
    expect(await reread(row.id)).toMatchObject({
      attempts: 2,
      nextAttemptAt: new Date(clock().getTime() + 60_000),
    });
  });

  it('honors a Retry-After and gives a row up as failed after its last try', async () => {
    const limited = await newRow();
    const rateLimited = async () => {
      throw new IdentityProviderError('rate_limited', 'too many', { retryAfterMs: 600_000 });
    };
    expect(await processOutboxRow({ db: t.db, clock }, limited, rateLimited)).toBe('retry');
    expect((await reread(limited.id))?.nextAttemptAt).toEqual(new Date(clock().getTime() + 600_000));

    const last = await newRow({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const before = last.nextAttemptAt;
    const broken = async () => {
      throw new Error('still broken');
    };
    expect(await processOutboxRow({ db: t.db, clock }, last, broken)).toBe('failed');
    expect(await reread(last.id)).toMatchObject({
      status: 'failed',
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: 'still broken',
      nextAttemptAt: before,
    });
  });

  it('fails a row at once on a give-up, with the cause as its error, and tells a handler its last try', async () => {
    const refused = new IdentityProviderError('invalid', 'quota exceeded');
    const giveUp = new OutboxGiveUpError(refused);
    expect(giveUp).toMatchObject({
      name: 'OutboxGiveUpError',
      message: 'invalid: quota exceeded',
      cause: refused,
    });
    const row = await newRow();
    const handler = async () => {
      throw giveUp;
    };
    expect(await processOutboxRow({ db: t.db, clock }, row, handler)).toBe('failed');
    expect(await reread(row.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'invalid: quota exceeded',
    });
    expect(isLastAttempt({ attempts: 0 })).toBe(false);
    expect(isLastAttempt({ attempts: OUTBOX_MAX_ATTEMPTS - 2 })).toBe(false);
    expect(isLastAttempt({ attempts: OUTBOX_MAX_ATTEMPTS - 1 })).toBe(true);
  });

  it('skips a row that is not pending, and never overwrites a row settled meanwhile', async () => {
    const done = await newRow({ status: 'done' });
    const handler = vi.fn(async () => undefined);
    expect(await processOutboxRow({ db: t.db, clock }, done, handler)).toBe('skipped');
    expect(handler).not.toHaveBeenCalled();

    const row = await newRow();
    const settle = async () => {
      await rawDb(t.db).update(identityOutbox).set({ status: 'failed' }).where(eq(identityOutbox.id, row.id));
    };
    expect(await processOutboxRow({ db: t.db, clock }, row, settle)).toBe('done');
    expect(await reread(row.id)).toMatchObject({ status: 'failed', attempts: 0 });
  });
});

describe('outboxProvider and outboxTenant', () => {
  it('gives the configured provider, and rejects without one so the row is tried again', () => {
    const fake = new FakeIdentityProvider();
    expect(outboxProvider(fake)).toBe(fake);
    expect(() => outboxProvider(undefined)).toThrow('No identity provider is configured (MWC_IDENTITY=none)');
  });

  it("opens the row's company, undefined once it is deleted, and passes on a database failure", async () => {
    expect((await outboxTenant(t.db, companyId))?.companyId).toBe(companyId);
    const deleted = await seedCompany(t.db);
    await rawDb(t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, deleted.company.id));
    expect(await outboxTenant(t.db, deleted.company.id)).toBeUndefined();
    expect(await outboxTenant(t.db, 'not-an-id')).toBeUndefined();
    await expect(outboxTenant(brokenDb(), companyId)).rejects.toThrow();
  });
});
