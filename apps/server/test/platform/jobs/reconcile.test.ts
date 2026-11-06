import { randomBytes } from 'node:crypto';
import { CompanyNotFoundError, companies } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import type { CompanyStatus } from '@mwc/shared/enums';
import { createTestApp, fixedClock, LEVEL, seedCompany, type TestApp } from '@mwc/testkit';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dueCompanies,
  RECONCILE_BATCH,
  RECONCILE_INTERVAL_MS,
  reconcileOffsetMs,
  reconcileRound,
  slotStartMs,
} from '../../../src/platform/jobs/reconcile.ts';
import { HOUR_MS, MINUTE_MS, reconciledAt, setReconciledAt } from '../../fixtures/platform/jobs.ts';

const INTERVAL = MINUTE_MS;
// A whole number of intervals (every slot boundary is its offset past it), a day ahead of real time.
const T0 = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS;
const clock = fixedClock(T0);
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock });
});
afterAll(() => t.close());
// Each test sees only its own companies: the earlier ones are suspended (never due).
beforeEach(async () => {
  clock.set(T0);
  await rawDb(t.db).update(companies).set({ status: 'suspended' });
});

/** A company linked to an organization (active unless said, linked unless `org: false`). */
async function company(status: CompanyStatus = 'active', org = true): Promise<string> {
  const identityOrgId = org ? `org_${randomBytes(6).toString('hex')}` : null;
  const deleted = status === 'deleted';
  const { id } = (await seedCompany(t.db, { status: deleted ? 'active' : status, identityOrgId })).company;
  // Soft-deleted as the companies module does it (a deleted company cannot be seeded through the tenant layer).
  if (deleted)
    await rawDb(t.db).update(companies).set({ status, deletedAt: clock() }).where(eq(companies.id, id));
  return id;
}
const round = (reconcile = vi.fn(async (_id: string) => {}), limit?: number) =>
  reconcileRound({
    db: t.db,
    clock,
    logger: t.logger,
    intervalMs: INTERVAL,
    reconcile,
    ...(limit === undefined ? {} : { limit }),
  });
const due = (limit = 100) => dueCompanies(t.db, { now: clock(), intervalMs: INTERVAL, limit });

describe('the slots', () => {
  it("places a company's slot by the last 32 bits of its id, and finds the slot a time falls in", () => {
    expect(reconcileOffsetMs('0195f0c2-7b1e-7c3d-9a4b-1234abcd5678', 2 ** 32)).toBe(0xabcd5678);
    expect(reconcileOffsetMs('0195f0c2-7b1e-7c3d-9a4b-1234abcd5678', RECONCILE_INTERVAL_MS)).toBe(
      0xabcd5678 % RECONCILE_INTERVAL_MS,
    );
    expect(reconcileOffsetMs('0195f0c2-7b1e-7c3d-9a4b-123400000000', INTERVAL)).toBe(0);
    expect(slotStartMs(1_000_250, 50, 100)).toBe(1_000_250);
    expect(slotStartMs(1_000_249, 50, 100)).toBe(1_000_150);
    expect(slotStartMs(1_000_000, 50, 100)).toBe(999_950);
    // Before the offset (only in tests): the slot that began in the interval before.
    expect(slotStartMs(5, 10, 100)).toBe(-90);
  });

  it('is computed by the database exactly as here, for any company and any last reconcile', async () => {
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(await company());
    for (const [i, id] of ids.entries()) {
      const at = i % 4 === 0 ? null : new Date(T0 - ((i * 7_919) % (2 * INTERVAL)));
      await setReconciledAt(t.db, id, at);
    }
    for (const offset of [0, 13_001, 29_999, 47_500, INTERVAL + 1]) {
      clock.set(T0 + offset);
      const rows = await rawDb(t.db).select().from(companies).where(inArray(companies.id, ids));
      const expected = rows
        .filter((row) => {
          const slot = slotStartMs(clock().getTime(), reconcileOffsetMs(row.id, INTERVAL), INTERVAL);
          return row.reconciledAt === null || row.reconciledAt.getTime() < slot;
        })
        .map((row) => row.id);
      expect((await due()).sort()).toEqual(expected.sort());
    }
  });
});

describe('reconcileRound', () => {
  it('reconciles a company never reconciled at once, then not again before its next slot', async () => {
    const id = await company();
    const reconcile = vi.fn(async (_id: string) => {});
    expect(await round(reconcile)).toEqual({ due: 1, reconciled: 1, failed: 0, skipped: 0 });
    expect(reconcile).toHaveBeenCalledWith(id);
    expect(await reconciledAt(t.db, id)).toEqual(clock());
    const next = slotStartMs(T0, reconcileOffsetMs(id, INTERVAL), INTERVAL) + INTERVAL;
    clock.set(next - 1);
    expect(await round(reconcile)).toMatchObject({ due: 0 });
    clock.set(next);
    expect(await round(reconcile)).toMatchObject({ due: 1, reconciled: 1 });
    expect(await reconciledAt(t.db, id)).toEqual(new Date(next));
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('spreads the companies over the interval: each comes round once, in the slot its id gives it', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await company());
    for (const id of ids) await setReconciledAt(t.db, id, new Date(T0));
    const step = INTERVAL / 10;
    const seen = new Map<string, number>();
    for (let s = 1; s <= 10; s++) {
      clock.set(T0 + s * step);
      await round(
        vi.fn(async (id: string) => {
          expect(seen.has(id)).toBe(false);
          seen.set(id, s);
        }),
        100,
      );
    }
    const expected = new Map(
      ids.map((id) => {
        const offset = reconcileOffsetMs(id, INTERVAL);
        return [id, offset === 0 ? 10 : Math.ceil(offset / step)];
      }),
    );
    expect(seen).toEqual(expected);
    expect(new Set(seen.values()).size).toBeGreaterThan(1);
  });

  it('skips companies that are deleted, provisioning, suspended or not linked to an organization', async () => {
    const active = await company();
    for (const status of ['deleted', 'provisioning', 'suspended'] as const) await company(status);
    await company('active', false);
    const reconcile = vi.fn(async (_id: string) => {});
    expect(await round(reconcile)).toEqual({ due: 1, reconciled: 1, failed: 0, skipped: 0 });
    expect(reconcile.mock.calls).toEqual([[active]]);
  });

  it('records the reconcile without touching the company otherwise (updated_at stays)', async () => {
    const id = await company();
    const read = async () => (await rawDb(t.db).select().from(companies).where(eq(companies.id, id)))[0];
    const before = await read();
    await round();
    const after = await read();
    expect(after?.reconciledAt).toEqual(clock());
    expect({ ...after, reconciledAt: null }).toEqual({ ...before, reconciledAt: null });
  });

  it('logs a failure, and tries the company again in its next slot rather than on every tick', async () => {
    const id = await company();
    const failing = vi.fn(async (_id: string) => {
      throw new IdentityProviderError('unavailable', 'provider down');
    });
    expect(await round(failing)).toEqual({ due: 1, reconciled: 0, failed: 1, skipped: 0 });
    const warn = t.logs.find(
      (line) => line.msg === 'jobs: company reconcile failed; it comes round again next slot',
    );
    expect(warn).toMatchObject({ level: LEVEL.warn, companyId: id, reason: 'unavailable: provider down' });
    expect(await reconciledAt(t.db, id)).toEqual(clock());
    expect(await round(failing)).toMatchObject({ due: 0 });
    clock.set(slotStartMs(T0, reconcileOffsetMs(id, INTERVAL), INTERVAL) + INTERVAL);
    expect(await round()).toMatchObject({ due: 1, reconciled: 1 });
  });

  it('skips a company deleted while the round ran, and leaves it as it is', async () => {
    const id = await company();
    const gone = vi.fn(async (companyId: string) => {
      throw new CompanyNotFoundError(companyId);
    });
    expect(await round(gone)).toEqual({ due: 1, reconciled: 0, failed: 0, skipped: 1 });
    expect(await reconciledAt(t.db, id)).toBeNull();
  });

  it('takes at most a batch per round, the never reconciled and the longest waiting first', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await company());
    const [never, oldest, older, recent] = ids as [string, string, string, string];
    await setReconciledAt(t.db, oldest, new Date(T0 - 3 * INTERVAL));
    await setReconciledAt(t.db, older, new Date(T0 - 2 * INTERVAL));
    await setReconciledAt(t.db, recent, new Date(T0 - INTERVAL - 1));
    const reconcile = vi.fn(async (_id: string) => {});
    expect(await round(reconcile, 3)).toMatchObject({ due: 3, reconciled: 3 });
    expect(reconcile.mock.calls.map(([id]) => id)).toEqual([never, oldest, older]);
    expect(await round(reconcile, 3)).toMatchObject({ due: 1, reconciled: 1 });
    expect(reconcile).toHaveBeenLastCalledWith(recent);
    expect(RECONCILE_BATCH).toBe(10);
  });
});
