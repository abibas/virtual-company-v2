import { seedCompany } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profilesOf, subjectOf } from '../../../src/modules/identity/service.ts';
import { type AuthWorld, addPerson, authWorld } from '../../fixtures/auth.ts';

describe('profilesOf and subjectOf', () => {
  let w: AuthWorld;
  beforeAll(async () => {
    w = await authWorld();
  });
  afterAll(() => w.t.close());

  it("reads people's profiles by id, leaving out unknown and malformed ids", async () => {
    const { company } = await seedCompany(w.t.db);
    const ada = await addPerson(w.t.db, w.fake, company.id);
    const bob = await addPerson(w.t.db, w.fake, company.id);
    const profiles = await profilesOf(w.t.db, [ada.userId, bob.userId, ada.userId, 'not-an-id', company.id]);
    expect([...profiles.keys()].sort()).toEqual([ada.userId, bob.userId].sort());
    expect(profiles.get(ada.userId)).toEqual({
      id: ada.userId,
      primaryEmail: `${ada.subject}@people.test`,
      displayName: ada.subject,
      imageUrl: null,
      status: 'active',
    });
    expect((await profilesOf(w.t.db, [])).size).toBe(0);
    expect((await profilesOf(w.t.db, ['not-an-id'])).size).toBe(0);
  });

  it("gives a person's subject at a provider, undefined at another one or for an unknown person", async () => {
    const { company } = await seedCompany(w.t.db);
    const ada = await addPerson(w.t.db, w.fake, company.id);
    expect(await subjectOf(w.t.db, ada.userId, 'fake')).toBe(ada.subject);
    expect(await subjectOf(w.t.db, ada.userId, 'clerk')).toBeUndefined();
    expect(await subjectOf(w.t.db, company.id, 'fake')).toBeUndefined();
    expect(await subjectOf(w.t.db, 'not-an-id', 'fake')).toBeUndefined();
  });
});
