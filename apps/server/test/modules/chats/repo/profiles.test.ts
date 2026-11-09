import { tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { createTestApp, seedCompany, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profilesRepo } from '../../../../src/modules/chats/repo/profiles.ts';
import { seedProfile } from '../../../fixtures/org.ts';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('profilesRepo', () => {
  it("reads a profile through its owner's layer, and nothing for an unknown one", async () => {
    const { company, owner } = await seedCompany(t.db);
    const scoped = await tenant(t.db, company.id);
    const profile = await seedProfile(t.db, owner.user.id);
    expect(await profilesRepo.ownerOf(scoped, profile.id)).toBe(owner.user.id);
    expect(await profilesRepo.get(scoped, profile.id)).toMatchObject({
      id: profile.id,
      ownerUserId: owner.user.id,
    });
    expect(await profilesRepo.get(scoped, newId())).toBeUndefined();
    expect(await profilesRepo.membershipOf(scoped, owner.user.id)).toMatchObject({ role: 'owner' });
  });
});
