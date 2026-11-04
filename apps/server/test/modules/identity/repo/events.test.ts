import { migrateToLatest } from '@mwc/db/system';
import type { IdentityInboxEvent } from '@mwc/shared/identity';
import { createTestDb, type TestDb } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDueInboxEvents,
  recordInboxEvent,
  recordInboxOutcome,
} from '../../../../src/modules/identity/repo/events.ts';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
});
afterAll(() => testDb.close());

const T = Date.parse('2026-11-03T12:00:00.000Z');
const at = (ms: number) => new Date(T + ms);
const deleted = (id: string, occurredAt = T): IdentityInboxEvent => ({
  provider: 'fake',
  externalEventId: id,
  occurredAt,
  type: 'user.deleted',
  data: { subject: 'user_1' },
});

describe('the inbox rows', () => {
  it('records a delivery once, pending and leased, and a replay as nothing', async () => {
    const row = await recordInboxEvent(testDb.handle, {
      event: deleted('evt_once'),
      now: at(0),
      leaseUntil: at(60),
    });
    expect(row).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: at(60), processedAt: null });
    expect(
      await recordInboxEvent(testDb.handle, { event: deleted('evt_once'), now: at(1), leaseUntil: at(61) }),
    ).toBeUndefined();
    const other = { ...deleted('evt_once'), provider: 'clerk' };
    expect(
      await recordInboxEvent(testDb.handle, { event: other, now: at(0), leaseUntil: at(60) }),
    ).toBeDefined();
  });

  it('claims due rows oldest event first, leases them, and skips given-up, processed and leased ones', async () => {
    const rows = [];
    for (const [id, before] of [
      ['evt_c2', 2],
      ['evt_c1', 1],
      ['evt_c3', 3],
    ] as const) {
      const event = deleted(id, T - before);
      rows.push(await recordInboxEvent(testDb.handle, { event, now: at(0), leaseUntil: at(100) }));
    }
    const [c2, c1, c3] = rows.map((row) => row?.id as string);
    await recordInboxOutcome(testDb.handle, c3 as string, {
      status: 'failed',
      attempts: 12,
      at: at(0),
      lastError: 'given up',
      nextAttemptAt: null,
    });
    const early = await claimDueInboxEvents(testDb.handle, { now: at(99), leaseUntil: at(500), limit: 10 });
    expect(early.map((row) => [row.provider, row.externalEventId])).toEqual([
      ['fake', 'evt_once'],
      ['clerk', 'evt_once'],
    ]);
    const claimed = await claimDueInboxEvents(testDb.handle, {
      now: at(100),
      leaseUntil: at(500),
      limit: 10,
    });
    expect(claimed.map((row) => row.externalEventId)).toEqual(['evt_c2', 'evt_c1']);
    expect(claimed.every((row) => row.nextAttemptAt?.getTime() === at(500).getTime())).toBe(true);
    expect(
      await claimDueInboxEvents(testDb.handle, { now: at(499), leaseUntil: at(900), limit: 10 }),
    ).toEqual([]);
    expect(
      await recordInboxOutcome(testDb.handle, c1 as string, { status: 'processed', attempts: 1, at: at(1) }),
    ).toBe(true);
    expect(
      await recordInboxOutcome(testDb.handle, c1 as string, { status: 'processed', attempts: 2, at: at(2) }),
    ).toBe(false);
    const again = await claimDueInboxEvents(testDb.handle, { now: at(500), leaseUntil: at(900), limit: 1 });
    expect(again.map((row) => row.id)).toHaveLength(1);
    expect(again[0]?.id).not.toBe(c1);
    expect(c2).toBeDefined();
  });

  it('records an ignored delivery processed at once, never claimed', async () => {
    const ignored: IdentityInboxEvent = {
      ...deleted('evt_ignored'),
      type: 'ignored',
      data: { providerType: 'email.created' },
    };
    const row = await recordInboxEvent(testDb.handle, { event: ignored, now: at(5), leaseUntil: at(60) });
    expect(row).toMatchObject({
      type: 'ignored',
      status: 'processed',
      processedAt: at(5),
      nextAttemptAt: null,
    });
    const claimed = await claimDueInboxEvents(testDb.handle, {
      now: at(10_000),
      leaseUntil: at(20_000),
      limit: 50,
    });
    expect(claimed.map((r) => r.externalEventId)).not.toContain('evt_ignored');
  });
});
