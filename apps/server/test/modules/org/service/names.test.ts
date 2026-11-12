import { principals, tenant, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { seedAgent, seedCompany, seedMember } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalNames, SOMEONE } from '../../../../src/modules/org/service/names.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { teamCompany } from '../../../fixtures/tasks.ts';

// The principals' names every module shows (tasks and flows, the inbox, the notifications): what the routes cannot
// reach, a principal that is neither an agent nor a person (none is made without one).
let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('principalNames', () => {
  it('names agents, people by display name or email, and anyone else Someone', async () => {
    const { company, owner, tenant: scoped } = await seedCompany(w.t.db, { owner: { displayName: 'Olga' } });
    const agent = await seedAgent(w.t.db, company.id, {
      name: 'SLOP BOX',
      slug: 'slop-box',
      reportsTo: null,
    });
    const nameless = await seedMember(w.t.db, company.id, {
      displayName: null,
      email: 'ann@acme.test',
      reportsTo: null,
    });
    const [bare] = await scoped.insert(principals, { kind: 'person' }).returning();
    const names = await principalNames(w.t.db, await tenant(w.t.db, company.id), [
      owner.principal.id,
      agent.principal.id,
      nameless.principal.id,
      bare?.id,
      null,
    ]);
    expect(names(owner.principal.id)).toMatchObject({ kind: 'person', name: 'Olga', slug: null });
    expect(names(agent.principal.id)).toMatchObject({ kind: 'agent', name: 'SLOP BOX', slug: 'slop-box' });
    expect(names(nameless.principal.id).name).toBe('ann@acme.test');
    expect(names(bare?.id as string)).toEqual({
      principalId: bare?.id,
      kind: 'person',
      name: SOMEONE,
      slug: null,
    });
  });

  it('names agents by name and slug, people by their name or else their email, and anyone else as Someone', async () => {
    const c = await teamCompany(w);
    await rawDb(w.t.db).update(users).set({ displayName: null }).where(eq(users.id, c.tester.userId));
    const t = await tenant(w.t.db, c.companyId);
    const stranger = newId();
    const names = await principalNames(w.t.db, t, [c.developer, c.tester.principalId, stranger, null]);
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
