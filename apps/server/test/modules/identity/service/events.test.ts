import { identityEvents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { IdentityInboxEvent, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { captureLogger } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDENTITY_EVENT_MAX_ATTEMPTS,
  INBOX_LEASE_MS,
  processInboxEvent,
  retryIdentityEvents,
} from '../../../../src/modules/identity/service/events.ts';
import { RETRY_FIRST_DELAY_MS, retryDelayMs } from '../../../../src/platform/jobs/retry.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/auth.ts';
import { auditOf } from '../../../fixtures/companies.ts';
import {
  acceptAtProvider,
  invite,
  memberWithEmail,
  runOutbox,
  signUp,
} from '../../../fixtures/invitations.ts';
import { membersCompany } from '../../../fixtures/members.ts';
import { testChart } from '../../../fixtures/org.ts';
import { deliverEvents, failWrites, inboxRow } from '../../../fixtures/webhooks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const deps = (logger = captureLogger().logger) => ({
  db: w.t.db,
  identity: w.fake,
  clock: w.clock,
  logger,
  chart: testChart(logger),
});

/** A company whose invitation of `email` was accepted at the fake: the user and invitation events delivered. */
async function acceptance(email: string) {
  const acme = await membersCompany(w);
  const sent = await invite(w, acme, email, 'member');
  await runOutbox(w, acme.companyId);
  w.fake.drainEvents();
  await acceptAtProvider(w, sent.id, signUp(w, email).subject);
  const events = w.fake.drainEvents();
  const membership = events.find((event) => event.type === 'membership.upserted') as NormalizedIdentityEvent;
  await deliverEvents(
    w,
    events.filter((event) => event !== membership),
  );
  return { acme, membership };
}

/** Delivers `event` while writes to memberships fail: the row is left `failed`; returns the switch back. */
async function failedDelivery(
  event: NormalizedIdentityEvent,
  table: 'memberships' | 'audit_log' = 'memberships',
) {
  const restore = await failWrites(w.t.db, table);
  expect(await deliverEvents(w, [event])).toEqual(['failed']);
  return restore;
}

/** A row put straight into the inbox (as if the server stopped before its inline try ended). */
async function stored(event: IdentityInboxEvent, nextAttemptAt: Date) {
  const [row] = await rawDb(w.t.db)
    .insert(identityEvents)
    .values({
      provider: event.provider,
      externalEventId: event.externalEventId,
      type: event.type,
      occurredAt: new Date(event.occurredAt),
      payload: event,
      nextAttemptAt,
    })
    .returning();
  return row as NonNullable<typeof row>;
}

describe('a delivery whose processing fails', () => {
  it('is still a 200, recorded failed with the backoff, and the retry loop projects it later', async () => {
    const { acme, membership } = await acceptance('retried@x.test');
    const logs = captureLogger();
    const restore = await failedDelivery(membership);
    const row = await inboxRow(w.t.db, membership.externalEventId);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, processedAt: null });
    expect(row?.lastError).toMatch(/memberships|check/i);
    expect(row?.nextAttemptAt).toEqual(new Date(w.clock().getTime() + RETRY_FIRST_DELAY_MS));
    expect(await memberWithEmail(w, acme, 'retried@x.test')).toBeUndefined();

    await restore();
    expect(await retryIdentityEvents(deps(logs.logger))).toEqual({
      claimed: 0,
      processed: 0,
      failed: 0,
      givenUp: 0,
    });
    w.clock.advance(RETRY_FIRST_DELAY_MS);
    expect(await retryIdentityEvents(deps(logs.logger))).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
      givenUp: 0,
    });
    expect(await inboxRow(w.t.db, membership.externalEventId)).toMatchObject({
      status: 'processed',
      attempts: 2,
      lastError: null,
      nextAttemptAt: null,
      processedAt: w.clock(),
    });
    expect(await memberWithEmail(w, acme, 'retried@x.test')).toMatchObject({ status: 'active' });
    expect(await retryIdentityEvents(deps())).toMatchObject({ claimed: 0 });
  });

  it('is given up after its last allowed try, with the failure logged and no next try', async () => {
    const { membership } = await acceptance('doomed@x.test');
    const restore = await failedDelivery(membership);
    const logs = captureLogger();
    try {
      for (let attempts = 1; attempts < IDENTITY_EVENT_MAX_ATTEMPTS; attempts++) {
        w.clock.advance(retryDelayMs(attempts));
        const last = attempts + 1 === IDENTITY_EVENT_MAX_ATTEMPTS;
        expect(await retryIdentityEvents(deps(logs.logger))).toEqual({
          claimed: 1,
          processed: 0,
          failed: last ? 0 : 1,
          givenUp: last ? 1 : 0,
        });
      }
    } finally {
      await restore();
    }
    expect(await inboxRow(w.t.db, membership.externalEventId)).toMatchObject({
      status: 'failed',
      attempts: IDENTITY_EVENT_MAX_ATTEMPTS,
      nextAttemptAt: null,
    });
    w.clock.advance(7 * 24 * 3_600_000);
    expect(await retryIdentityEvents(deps())).toMatchObject({ claimed: 0 });
    const warned = logs.lines.filter((line) => line.msg === 'identity event failed');
    expect(warned).toHaveLength(IDENTITY_EVENT_MAX_ATTEMPTS - 1);
    expect(warned.at(-1)).toMatchObject({ givenUp: true, attempts: IDENTITY_EVENT_MAX_ATTEMPTS });
    expect(JSON.stringify(warned)).not.toContain('payload');
  });

  it('rolls its audit rows back with the projection: both land together on the retry', async () => {
    const { acme, membership } = await acceptance('atomic@x.test');
    const restore = await failedDelivery(membership, 'audit_log');
    const ofEvent = async () =>
      (await auditOf(w.t.db, acme.companyId)).filter((row) => row.requestId === membership.externalEventId);
    expect(await memberWithEmail(w, acme, 'atomic@x.test')).toBeUndefined();
    expect(await ofEvent()).toEqual([]);
    await restore();
    w.clock.advance(RETRY_FIRST_DELAY_MS);
    expect(await retryIdentityEvents(deps())).toMatchObject({ claimed: 1, processed: 1 });
    expect(await memberWithEmail(w, acme, 'atomic@x.test')).toMatchObject({ status: 'active' });
    expect((await ofEvent()).filter((row) => row.entityType === 'membership')).toHaveLength(6);
  });
});

describe('retryIdentityEvents', () => {
  const ignored = (id: string): IdentityInboxEvent => ({
    provider: 'fake',
    externalEventId: id,
    occurredAt: w.clock().getTime(),
    type: 'ignored',
    data: { providerType: 'session.created' },
  });

  it('takes a pending event whose inline try never finished once its lease is over', async () => {
    const row = await stored(ignored('evt_stranded'), new Date(w.clock().getTime() + INBOX_LEASE_MS));
    expect(await retryIdentityEvents(deps())).toMatchObject({ claimed: 0 });
    w.clock.advance(INBOX_LEASE_MS);
    expect(await retryIdentityEvents(deps())).toEqual({ claimed: 1, processed: 1, failed: 0, givenUp: 0 });
    expect(await inboxRow(w.t.db, row.externalEventId)).toMatchObject({ status: 'processed', attempts: 1 });
  });

  it('claims at most `limit` events, oldest first, and two passes at once take each event once', async () => {
    const due = new Date(w.clock().getTime());
    const at = w.clock().getTime();
    const ids = ['evt_batch_c', 'evt_batch_a', 'evt_batch_b'];
    for (const [index, id] of ids.entries()) await stored({ ...ignored(id), occurredAt: at - index }, due);
    const first = await retryIdentityEvents(deps(), { limit: 2 });
    expect(first).toMatchObject({ claimed: 2, processed: 2 });
    expect((await inboxRow(w.t.db, 'evt_batch_b'))?.status).toBe('processed');
    expect((await inboxRow(w.t.db, 'evt_batch_a'))?.status).toBe('processed');
    for (const id of ['evt_race_1', 'evt_race_2', 'evt_race_3']) await stored(ignored(id), due);
    const passes = await Promise.all([retryIdentityEvents(deps()), retryIdentityEvents(deps())]);
    expect(passes.reduce((sum, pass) => sum + pass.claimed, 0)).toBe(4);
    expect(passes.reduce((sum, pass) => sum + pass.processed, 0)).toBe(4);
  });
});

describe('processInboxEvent', () => {
  it('leaves a row another try finished alone, whatever its own outcome', async () => {
    const { membership } = await acceptance('raced@x.test');
    const event = { ...membership, externalEventId: 'evt_raced' };
    const row = await stored(event, w.clock());
    expect(await processInboxEvent(deps(), row)).toBe('processed');
    expect(await processInboxEvent(deps(), row)).toBe('skipped');
    const restore = await failWrites(w.t.db, 'memberships');
    try {
      const stale = {
        ...row,
        payload: { ...event, data: { ...membership.data, updatedAt: Date.now() + 1e9 } },
      };
      expect(await processInboxEvent(deps(), stale as typeof row)).toBe('skipped');
    } finally {
      await restore();
    }
    expect(
      (await rawDb(w.t.db).select().from(identityEvents).where(eq(identityEvents.id, row.id)))[0],
    ).toMatchObject({ status: 'processed', attempts: 1, lastError: null });
  });
});
