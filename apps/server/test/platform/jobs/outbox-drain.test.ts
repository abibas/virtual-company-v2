import { type IdentityOutboxRow, identityOutbox, type TenantDb } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { IdentityOutboxOp } from '@mwc/shared/enums';
import { createTestApp, fixedClock, seedCompany, type TestApp } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueOutbox,
  OUTBOX_FIRST_DELAY_MS,
  OUTBOX_MAX_ATTEMPTS,
  OutboxGiveUpError,
  type OutboxHandler,
  outboxKey,
} from '../../../src/platform/jobs/outbox.ts';
import {
  claimDueOutbox,
  drainOutbox,
  OUTBOX_BATCH,
  OUTBOX_LEASE_MS,
  outboxRegistry,
} from '../../../src/platform/jobs/outbox-drain.ts';
import { HOUR_MS } from '../../fixtures/jobs.ts';

// Ahead of the database's now(), so rows stamped by default are due.
const clock = fixedClock(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS);
let t: TestApp;
let scoped: TenantDb;
beforeAll(async () => {
  t = await createTestApp({ clock });
  scoped = (await seedCompany(t.db)).tenant;
});
afterAll(() => t.close());
// Each test starts from an empty outbox.
beforeEach(async () => {
  await rawDb(t.db).delete(identityOutbox);
});

let seq = 0;
/** A new pending row of `op` (with `values` patched in). */
async function newRow(op: IdentityOutboxOp, values: Partial<IdentityOutboxRow> = {}) {
  const row = (await enqueueOutbox(scoped, {
    op,
    idempotencyKey: outboxKey(op, `drain-${++seq}`),
  })) as IdentityOutboxRow;
  if (Object.keys(values).length === 0) return row;
  await rawDb(t.db).update(identityOutbox).set(values).where(eq(identityOutbox.id, row.id));
  return { ...row, ...values };
}
const reread = async (id: string) =>
  (await rawDb(t.db).select().from(identityOutbox).where(eq(identityOutbox.id, id)))[0] as IdentityOutboxRow;
const deps = () => ({ db: t.db, clock, logger: t.logger });

describe('outboxRegistry', () => {
  it("combines the modules' handler maps into one, and refuses an op two of them handle", () => {
    const handler: OutboxHandler = async () => {};
    const other: OutboxHandler = async () => {};
    const registry = outboxRegistry({ create_org: handler }, { invite: other, revoke_invite: other }, {});
    expect(registry).toEqual({ create_org: handler, invite: other, revoke_invite: other });
    expect(() => outboxRegistry({ invite: handler }, { invite: other })).toThrow(
      'two outbox handlers for the op invite',
    );
  });
});

describe('claimDueOutbox', () => {
  it('claims the pending rows whose time has come, leases them, and returns them in enqueue order', async () => {
    const now = clock();
    const first = await newRow('create_org', { nextAttemptAt: new Date(now.getTime() - 1000) });
    const second = await newRow('invite');
    const third = await newRow('invite', { nextAttemptAt: new Date(now.getTime() + 1) });
    await newRow('invite', { status: 'done' });
    await newRow('invite', { status: 'failed' });
    const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS);
    const claimed = await claimDueOutbox(t.db, { now, leaseUntil, limit: OUTBOX_BATCH });
    expect(claimed.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(claimed.every((row) => row.nextAttemptAt.getTime() === leaseUntil.getTime())).toBe(true);
    // Leased: not due again until the lease ends.
    expect(await claimDueOutbox(t.db, { now, leaseUntil, limit: OUTBOX_BATCH })).toEqual([]);
    // After the lease the two are due again (a try that never finished), with the one due a little later.
    const after = new Date(leaseUntil.getTime());
    const again = await claimDueOutbox(t.db, {
      now: after,
      leaseUntil: new Date(after.getTime() + 1),
      limit: 10,
    });
    expect(again.map((row) => row.id)).toEqual([first.id, second.id, third.id]);
  });

  it('claims at most the batch, the longest due first, and never one row twice when two passes run at once', async () => {
    const now = clock();
    const rows: IdentityOutboxRow[] = [];
    for (let i = 0; i < 6; i++)
      rows.push(await newRow('invite', { nextAttemptAt: new Date(now.getTime() - i) }));
    const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS);
    const oldest = await claimDueOutbox(t.db, { now, leaseUntil, limit: 2 });
    expect(oldest.map((row) => row.id).sort()).toEqual([rows[5]?.id, rows[4]?.id].sort());
    const [a, b] = await Promise.all([
      claimDueOutbox(t.db, { now, leaseUntil, limit: 3 }),
      claimDueOutbox(t.db, { now, leaseUntil, limit: 3 }),
    ]);
    const ids = [...a, ...b].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      rows
        .slice(0, 4)
        .map((row) => row.id)
        .sort(),
    );
  });
});

describe('drainOutbox', () => {
  it("runs each claimed row with its op's handler and records the outcome", async () => {
    const created = await newRow('create_org');
    const invited = await newRow('invite');
    const order: string[] = [];
    const handlers = {
      create_org: vi.fn<OutboxHandler>(async (row) => void order.push(`create_org ${row.id}`)),
      invite: vi.fn<OutboxHandler>(async (row) => void order.push(`invite ${row.id}`)),
    };
    expect(await drainOutbox(deps(), handlers)).toEqual({
      claimed: 2,
      done: 2,
      retry: 0,
      failed: 0,
      skipped: 0,
    });
    expect(order).toEqual([`create_org ${created.id}`, `invite ${invited.id}`]);
    for (const id of [created.id, invited.id]) {
      expect(await reread(id)).toMatchObject({ status: 'done', attempts: 1, completedAt: clock() });
    }
    expect(await drainOutbox(deps(), handlers)).toEqual({
      claimed: 0,
      done: 0,
      retry: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it('fails a row whose op has no handler at once, and says so in last_error', async () => {
    const orphan = await newRow('delete_org');
    expect(await drainOutbox(deps(), { invite: async () => {} })).toMatchObject({ claimed: 1, failed: 1 });
    expect(await reread(orphan.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'no outbox handler for the op "delete_org"',
    });
  });

  it('tries a failing row again after the backoff, and gives it up after its last try or a refusal', async () => {
    const flaky = await newRow('invite');
    const failing = vi.fn<OutboxHandler>(async () => {
      throw new Error('provider down');
    });
    expect(await drainOutbox(deps(), { invite: failing })).toMatchObject({ claimed: 1, retry: 1 });
    const retried = await reread(flaky.id);
    expect(retried).toMatchObject({ status: 'pending', attempts: 1, lastError: 'provider down' });
    expect(retried.nextAttemptAt.getTime()).toBe(clock().getTime() + OUTBOX_FIRST_DELAY_MS);
    // Not due before its backoff ends.
    clock.advance(OUTBOX_FIRST_DELAY_MS - 1);
    expect(await drainOutbox(deps(), { invite: failing })).toMatchObject({ claimed: 0 });
    clock.advance(1);
    expect(await drainOutbox(deps(), { invite: async () => {} })).toMatchObject({ claimed: 1, done: 1 });

    const last = await newRow('invite', { attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const refused = await newRow('invite');
    const refusal = vi.fn<OutboxHandler>(async (row) => {
      throw row.id === refused.id
        ? new OutboxGiveUpError(new Error('invalid: member limit'))
        : new Error('down');
    });
    expect(await drainOutbox(deps(), { invite: refusal })).toMatchObject({ claimed: 2, failed: 2 });
    expect(await reread(last.id)).toMatchObject({
      status: 'failed',
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: 'down',
    });
    expect(await reread(refused.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'invalid: member limit',
    });
  });

  it('takes one batch per pass', async () => {
    for (let i = 0; i < 3; i++) await newRow('invite');
    const handlers = { invite: async () => {} };
    expect(await drainOutbox(deps(), handlers, { limit: 2 })).toMatchObject({ claimed: 2, done: 2 });
    expect(await drainOutbox(deps(), handlers, { limit: 2 })).toMatchObject({ claimed: 1, done: 1 });
  });
});
