import { companies, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { brokenDb, FAKE_ISSUER, testConfig } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { companiesService, randomSuffix } from '../../../src/modules/companies/service.ts';
import type { Actor } from '../../../src/platform/auth/actor.ts';
import { addUser, createCompany } from '../../fixtures/companies/companies.ts';
import { type AuthWorld, authWorld } from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const actorOf = (userId: string, subject: string): Actor => ({
  kind: 'user',
  via: 'clerk',
  userId,
  identity: { issuer: FAKE_ISSUER, subject, pending: false },
});

describe('companiesService', () => {
  it('makes six-character random slug suffixes', () => {
    for (let i = 0; i < 20; i++) expect(randomSuffix()).toMatch(/^[0-9a-z]{6}$/);
  });

  it('refuses with 409 when every slug derived from the name is taken', async () => {
    const user = await addUser(w.t.db, w.fake);
    const taken = ['busy', ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `busy-${n}`), 'busy-pinned'];
    await rawDb(w.t.db)
      .insert(companies)
      .values(taken.map((slug) => ({ slug, name: slug })));
    const service = companiesService(
      { db: w.t.db, config: testConfig, identity: w.fake },
      { randomSuffix: () => 'pinned' },
    );
    expect(await service.create(actorOf(user.userId, user.subject), { name: 'Busy' }, 'req')).toEqual({
      ok: false,
      status: 409,
      code: 'slug_taken',
      message: 'No free slug was found for this name; choose one',
    });
  });

  it('passes on database failures that are not a taken slug', async () => {
    const user = await addUser(w.t.db, w.fake);
    const broken = companiesService({ db: brokenDb(), config: testConfig, identity: w.fake });
    await expect(
      broken.create(actorOf(user.userId, user.subject), { name: 'Broken' }, 'req'),
    ).rejects.toThrow();

    const company = await createCompany(w, user.token, { name: 'Check Violation' });
    const scoped = await tenant(w.t.db, company.id);
    const service = companiesService({ db: w.t.db, config: testConfig, identity: w.fake });
    const member = {
      id: 'm',
      companyId: company.id,
      principalId: 'p',
      userId: user.userId,
      role: 'owner' as const,
    };
    // A slug the CHECK refuses (the route's schema would have stopped it) is no 409.
    await expect(service.update(scoped, member, { slug: 'Not Valid' }, 'req')).rejects.toThrow();
  });
});
