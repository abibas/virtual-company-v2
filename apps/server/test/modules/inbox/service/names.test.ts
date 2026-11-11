import { tenant, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inboxRepo } from '../../../../src/modules/inbox/repo.ts';
import { namesOf, SOMEONE } from '../../../../src/modules/inbox/service/names.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('namesOf', () => {
  it('names agents by name and slug, people by their name or else their email, and anyone else as Someone', async () => {
    const c = await teamCompany(w);
    await rawDb(w.t.db).update(users).set({ displayName: null }).where(eq(users.id, c.tester.userId));
    const t = await tenant(w.t.db, c.companyId);
    const stranger = newId();
    const names = await namesOf(w.t.db, inboxRepo, t, [c.developer, c.tester.principalId, stranger, null]);
    expect(names(c.developer)).toEqual({
      principalId: c.developer,
      kind: 'agent',
      name: 'Developer',
      slug: 'developer',
    });
    expect(names(c.tester.principalId)).toEqual({
      principalId: c.tester.principalId,
      kind: 'person',
      name: `${c.tester.subject}@people.test`,
      slug: null,
    });
    expect(names(stranger)).toEqual({ principalId: stranger, kind: 'person', name: SOMEONE, slug: null });
  });
});
