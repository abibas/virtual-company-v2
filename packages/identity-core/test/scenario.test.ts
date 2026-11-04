import { isId } from '@mwc/shared/ids';
import { describe, expect, it } from 'vitest';
import { InMemoryIdentityStore } from '../src/memory-store.ts';
import {
  applyAll,
  buildPersonHistory,
  buildScenario,
  fakeWorld,
  invitationMetadata,
  scenarioId,
  T0,
} from '../src/scenario.ts';

describe('the identity scenario', () => {
  it('uses every event type the projector handles, more than 40 events', async () => {
    const scenario = await buildScenario();
    expect(new Set(scenario.events.map((e) => e.type))).toEqual(
      new Set([
        'user.upserted',
        'user.deleted',
        'org.upserted',
        'membership.upserted',
        'membership.deleted',
        'invitation.accepted',
        'invitation.revoked',
      ]),
    );
    expect(scenario.events.length).toBeGreaterThan(40);
    expect(scenario.subjects).toContain('u_ivan');
  });

  it('makes the same UUIDs from the same names on every build, and names them back', async () => {
    const [a, b] = [await buildScenario(), await buildScenario()];
    expect([...a.orgs.keys()]).toEqual([scenarioId('c-acme'), scenarioId('c-globex')]);
    expect([...b.orgs.keys()]).toEqual([...a.orgs.keys()]);
    expect(isId(scenarioId('c-acme'))).toBe(true);
    expect(scenarioId('c-acme')).not.toBe(scenarioId('c-globex'));
    expect(a.nameOf(scenarioId('inv-dave-2'))).toBe('inv-dave-2');
    expect(a.nameOf('not-made-here')).toBe('not-made-here');
  });

  it('seeds a store with the companies, their owners and every invitation, which then takes the events', async () => {
    const scenario = await buildScenario();
    const store = new InMemoryIdentityStore();
    await scenario.seed(store);
    const seeded = store.snapshot();
    expect(seeded.companies.map((c) => scenario.nameOf(c.id)).sort()).toEqual(['c-acme', 'c-globex']);
    expect(seeded.memberships.map((m) => `${m.user}:${m.role}`).sort()).toEqual([
      'u_other:owner',
      'u_owner:owner',
    ]);
    expect(seeded.invitations).toHaveLength(10);
    // dave's second invitation goes to his other address: one pending invitation per email and company.
    const dave = seeded.invitations.filter((i) => scenario.nameOf(i.id).startsWith('inv-dave'));
    expect(dave.map((i) => i.email).sort()).toEqual(['dave@work.test', 'dave@x.test']);
    const changes = await applyAll(scenario.events, store, scenario.ctx);
    expect(changes.some((c) => c.action === 'accepted')).toBe(true);
  });

  it("builds one person's six-event history and its seed", async () => {
    const history = await buildPersonHistory();
    expect(history.events.map((e) => e.type)).toEqual([
      'user.upserted',
      'invitation.accepted',
      'membership.upserted',
      'membership.upserted',
      'user.upserted',
      'membership.deleted',
    ]);
    const store = new InMemoryIdentityStore();
    await history.seed(store);
    expect(await store.getCompany(history.companyId)).toMatchObject({ status: 'active' });
    expect(await store.getInvitation(history.invitationId)).toMatchObject({
      role: 'viewer',
      status: 'pending',
    });
  });

  it('runs the fake on a standing clock and puts our metadata on invitations', () => {
    const { fake, ctx } = fakeWorld();
    expect(ctx.issuer).toBe(fake.issuer);
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    expect(fake.drainEvents()[0]?.occurredAt).toBe(T0);
    expect(invitationMetadata('i1', 'c1')).toEqual({ mwc_invitation_id: 'i1', mwc_company_id: 'c1' });
  });
});
