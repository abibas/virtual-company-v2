import { identityOutbox } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, fixedClock, seedCompany, type TestApp } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueOutbox } from '../../../src/platform/jobs/outbox.ts';
import { JOBS_OFF, outboxBacklog } from '../../../src/platform/jobs/status.ts';
import { HOUR_MS } from '../../fixtures/jobs.ts';

const clock = fixedClock(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS);
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock });
});
afterAll(() => t.close());

describe('the jobs status', () => {
  it('says the jobs are off, with no lock and no tick, for a process that does not run them', () => {
    expect(JOBS_OFF.status()).toEqual({ enabled: false, holdsLock: false, lastTickAt: null });
  });

  it('counts the outbox rows due now and the ones failed for good, not the others', async () => {
    expect(await outboxBacklog(t.db, clock())).toEqual({ due: 0, failed: 0 });
    const scoped = (await seedCompany(t.db)).tenant;
    for (const key of ['a', 'b', 'c', 'd'])
      await enqueueOutbox(scoped, { op: 'invite', idempotencyKey: key });
    const rows = await rawDb(t.db).select().from(identityOutbox);
    const [, later, done, failed] = rows.sort((a, b) => a.id.localeCompare(b.id));
    const patch = async (id: string | undefined, set: Partial<typeof identityOutbox.$inferInsert>) =>
      rawDb(t.db)
        .update(identityOutbox)
        .set(set)
        .where(eq(identityOutbox.id, id ?? ''));
    await patch(later?.id, { nextAttemptAt: new Date(clock().getTime() + 1) });
    await patch(done?.id, { status: 'done' });
    await patch(failed?.id, { status: 'failed' });
    expect(await outboxBacklog(t.db, clock())).toEqual({ due: 1, failed: 1 });
    expect(await outboxBacklog(t.db, new Date(clock().getTime() + 1))).toEqual({ due: 2, failed: 1 });
  });
});
