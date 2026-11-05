import { companies } from '@mwc/db';
import { migrateToLatest, type RawDb, rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { createTestDb, seedCompany, type TestDb } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chartStep, lockedTenant } from '../../../../src/modules/identity/repo/chart.ts';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
});
afterAll(() => testDb.close());

describe('chartStep', () => {
  it('places a person whose membership turns active and takes off one whose membership stops being active', () => {
    expect(chartStep(undefined, 'active')).toBe('place');
    expect(chartStep('invited', 'active')).toBe('place');
    expect(chartStep('suspended', 'active')).toBe('place');
    expect(chartStep('removed', 'active')).toBe('place');
    expect(chartStep('active', 'removed')).toBe('unplace');
    expect(chartStep('active', 'suspended')).toBe('unplace');
  });

  it('does nothing while the membership stays active, or stays off', () => {
    expect(chartStep('active', 'active')).toBeUndefined();
    expect(chartStep(undefined, 'removed')).toBeUndefined();
    expect(chartStep('invited', 'removed')).toBeUndefined();
    expect(chartStep('suspended', 'removed')).toBeUndefined();
  });
});

describe('lockedTenant', () => {
  it('opens the company’s tenant with its row locked, in the transaction it is given', async () => {
    const { company } = await seedCompany(testDb.handle);
    const t = await rawDb(testDb.handle).transaction((tx) => lockedTenant(tx, company.id));
    expect(t?.companyId).toBe(company.id);
  });

  it('is undefined for a deleted company, whose chart stays as it is, and for an unknown one', async () => {
    const { company } = await seedCompany(testDb.handle);
    await rawDb(testDb.handle)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, company.id));
    expect(await lockedTenant(rawDb(testDb.handle), company.id)).toBeUndefined();
    expect(await lockedTenant(rawDb(testDb.handle), newId())).toBeUndefined();
  });

  it('passes on any other failure', async () => {
    const lost = new Error('connection lost');
    const failing = {
      select: () => ({ from: () => ({ where: () => Promise.reject(lost) }) }),
    } as unknown as RawDb;
    await expect(lockedTenant(failing, newId())).rejects.toBe(lost);
  });
});
