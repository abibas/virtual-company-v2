import { type notifications, tenant } from '@mwc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationsRepo } from '../../../../src/modules/notifications/repo.ts';
import { mentioned, namesOf, SOMEONE } from '../../../../src/modules/notifications/service/names.ts';
import { membersCompany } from '../../../fixtures/members/members.ts';
import { makeAgent, placedMember } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

// The names a notice shows are read when it is shown: a person's name (their email without one), an agent's name and
// slug, and "Someone" for a principal not found.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const MISSING = '0190f5f0-0000-7000-8000-000000000000';

describe('namesOf', () => {
  it('names people and agents as they are now, and nobody known as Someone', async () => {
    const company = await membersCompany(w);
    const mia = await placedMember(w, company, 'member');
    const agent = await makeAgent(w, company, company.owner, { name: 'Night Shift' });
    const t = await tenant(w.t.db, company.companyId);
    const names = await namesOf(w.t.db, notificationsRepo(), t, [
      mia.principalId,
      agent.principalId,
      MISSING,
    ]);
    expect(names.name(mia.principalId)).toBe(mia.subject);
    expect(names.name(agent.principalId)).toBe('Night Shift');
    expect(names.agentSlug(agent.principalId)).toBe(agent.slug);
    expect(names.agentSlug(mia.principalId)).toBeUndefined();
    expect(names.name(MISSING)).toBe(SOMEONE);
    expect(names.name(null)).toBe(SOMEONE);
    expect(names.name(undefined)).toBe(SOMEONE);
    const none = await namesOf(w.t.db, notificationsRepo(), t, []);
    expect(none.name(mia.principalId)).toBe(SOMEONE);
  });
});

describe('mentioned', () => {
  it('lists each principal a notice names once, skipping the empty ones', () => {
    const row = (payload: Record<string, unknown>, actor: string | null) =>
      ({ payload, actorPrincipalId: actor }) as unknown as typeof notifications.$inferSelect;
    expect(
      mentioned([row({ about: 'm', from: 'a', to: null }, 'o'), row({ about: 'm', to: 'b' }, null)]),
    ).toEqual(['m', 'a', 'o', 'b']);
  });
});
