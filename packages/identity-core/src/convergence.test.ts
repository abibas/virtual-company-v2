import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryIdentityStore } from './memory-store.ts';
import type { ProjectionChange } from './projector.ts';
import {
  acmeWorld,
  applyAll,
  buildScenario,
  permutations,
  type Scenario,
  seededRandom,
  shuffled,
} from './test-world.ts';

/** True when a change list did nothing: only notes (ignored, parked again, refused), no field changed. */
function noop(changes: readonly ProjectionChange[]): boolean {
  return changes.every((c) => ['ignored', 'deferred', 'refused'].includes(c.action) && c.fields.length === 0);
}

let scenario: Scenario;
let inOrder: ReturnType<InMemoryIdentityStore['snapshot']>;

beforeAll(async () => {
  scenario = await buildScenario();
  const store = scenario.seed();
  await applyAll(scenario.events, store, scenario.ctx);
  inOrder = store.snapshot();
});

describe('the scenario applied in order', () => {
  it('uses every event type the projector handles', () => {
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
  });

  it('ends with each rule applied', () => {
    const acme = Object.fromEntries(
      inOrder.memberships
        .filter((m) => m.companyId === 'c-acme')
        .map((m) => [
          m.user,
          { role: m.role, granted: m.grantedRole, status: m.status, inv: m.invitationId },
        ]),
    );
    expect(acme).toEqual({
      u_owner: { role: 'owner', granted: 'owner', status: 'active', inv: null },
      u_bob: { role: 'admin', granted: 'member', status: 'active', inv: 'inv-bob' },
      u_carol: { role: 'admin', granted: 'admin', status: 'active', inv: 'inv-carol' },
      u_dave: { role: 'member', granted: 'member', status: 'active', inv: 'inv-dave-2' },
      u_judy: { role: 'member', granted: 'member', status: 'removed', inv: 'inv-judy' },
      u_frank: { role: 'member', granted: 'member', status: 'removed', inv: 'inv-frank' },
      u_ivan: { role: 'member', granted: 'member', status: 'active', inv: 'inv-ivan' },
    });
    expect(inOrder.memberships.find((m) => m.user === 'u_owner')?.providerRole).toBe('org:member');
    expect(inOrder.memberships.filter((m) => m.companyId === 'c-globex').map((m) => m.user)).toEqual([
      'u_other',
    ]);

    const invitations = Object.fromEntries(
      inOrder.invitations.map((i) => [i.id, `${i.status}:${i.acceptedBy ?? '-'}`]),
    );
    expect(invitations).toEqual({
      'inv-bob': 'accepted:u_bob',
      'inv-bob-globex': 'pending:-',
      'inv-carol': 'accepted:u_carol',
      'inv-dave-1': 'accepted:u_dave',
      'inv-dave-2': 'accepted:u_dave',
      'inv-frank': 'accepted:u_frank',
      'inv-gina': 'revoked:-',
      'inv-hank': 'accepted:-',
      'inv-ivan': 'accepted:u_ivan',
      'inv-judy': 'accepted:u_judy',
    });
    expect(inOrder.invitations.find((i) => i.id === 'inv-ivan')?.externalInvitationId).not.toBeNull();

    const users = Object.fromEntries(inOrder.users.map((u) => [u.subject, u.status]));
    expect(users).toMatchObject({ u_frank: 'deactivated', u_bob: 'active', u_erin: 'active' });
    expect(inOrder.users.find((u) => u.subject === 'u_bob')?.displayName).toBe('Bob B.');
    expect(inOrder.deferred).toEqual({});
  });
});

describe('convergence', () => {
  it('gives the same store for 200 seeded shuffles of the events', async () => {
    const random = seededRandom(20261103);
    for (let run = 0; run < 200; run++) {
      const store = scenario.seed();
      await applyAll(shuffled(scenario.events, random), store, scenario.ctx);
      expect(store.snapshot(), `shuffle ${run}`).toEqual(inOrder);
    }
  });

  it('gives the same store when every event is delivered twice, in shuffled order', async () => {
    const random = seededRandom(7);
    for (let run = 0; run < 25; run++) {
      const store = scenario.seed();
      await applyAll(shuffled([...scenario.events, ...scenario.events], random), store, scenario.ctx);
      expect(store.snapshot(), `run ${run}`).toEqual(inOrder);
    }
  });

  it('treats a second application of every event as a no-op', async () => {
    const store = scenario.seed();
    await applyAll(scenario.events, store, scenario.ctx);
    for (const event of shuffled(scenario.events, seededRandom(1))) {
      const changes = await applyAll([event], store, scenario.ctx);
      expect(noop(changes), `${event.type} ${event.externalEventId}: ${JSON.stringify(changes)}`).toBe(true);
    }
    expect(store.snapshot()).toEqual(inOrder);
  });

  it('converges in every one of the 720 orders of one person joining, being promoted and removed', async () => {
    const results = new Set<string>();
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    const invitation = await w.fake.createInvitation({
      orgExternalId: w.org.externalId,
      email: 'bob@x.test',
      role: 'viewer',
      metadata: { mwc_invitation_id: 'inv-bob', mwc_company_id: w.company.id },
    });
    w.fake.accept(invitation.externalId, 'u_bob');
    await w.fake.updateMemberRole(w.org.externalId, 'u_bob', 'admin');
    w.fake.updateUser('u_bob', { displayName: 'Bob' });
    await w.fake.removeMember(w.org.externalId, 'u_bob');
    const events = w.fake.drainEvents();
    expect(events.map((e) => e.type)).toEqual([
      'user.upserted',
      'invitation.accepted',
      'membership.upserted',
      'membership.upserted',
      'user.upserted',
      'membership.deleted',
    ]);
    for (const order of permutations(events)) {
      const store = new InMemoryIdentityStore();
      store.addCompany({ id: w.company.id, identityOrgExternalId: w.org.externalId });
      store.addInvitation({
        id: 'inv-bob',
        companyId: w.company.id,
        email: 'bob@x.test',
        role: 'viewer',
        externalInvitationId: invitation.externalId,
      });
      await applyAll(order, store, w.ctx);
      results.add(JSON.stringify(store.snapshot()));
    }
    expect(results.size).toBe(1);
    const [only] = [...results];
    const snapshot = JSON.parse(only ?? '{}') as ReturnType<InMemoryIdentityStore['snapshot']>;
    expect(snapshot.memberships).toMatchObject([
      { user: 'u_bob', status: 'removed', role: 'admin', grantedRole: 'viewer', providerRole: 'org:admin' },
    ]);
    expect(snapshot.users).toMatchObject([{ subject: 'u_bob', displayName: 'Bob', status: 'active' }]);
  });
});
