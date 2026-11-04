import type { ProjectionChange } from '@mwc/identity-core';
import {
  applyAll,
  buildPersonHistory,
  buildScenario,
  permutations,
  type Scenario,
  seededRandom,
  shuffled,
} from '@mwc/identity-core/scenario';
import { expect } from 'vitest';
import { memorySeedableStore } from './memory-target.ts';
import type { IdentitySnapshot, StoreContractCase, StoreContractTarget } from './target.ts';

/**
 * The projector's convergence on the store: the scenario of `@mwc/identity-core/scenario` (41 events,
 * every event type, a person per rule) applied in order, shuffled, delivered twice, and one person's
 * history in many orders, must always leave the same store, and the same one the in-memory store ends with.
 */

let built: Promise<Scenario> | undefined;
/** The scenario, built once per test process (it is deterministic, and the cases only read it). */
export const scenario = () => {
  built ??= buildScenario();
  return built;
};

/** Seeds a fresh store, applies `events`, and returns its snapshot. */
async function run(
  target: StoreContractTarget,
  s: Scenario,
  events: Scenario['events'],
): Promise<IdentitySnapshot> {
  const fresh = await target.fresh();
  await s.seed(fresh);
  await applyAll(events, fresh.store, s.ctx);
  return fresh.snapshot();
}

/** True when a change list did nothing: only notes (ignored, parked again, refused), no field changed. */
function noop(changes: readonly ProjectionChange[]): boolean {
  return changes.every((c) => ['ignored', 'deferred', 'refused'].includes(c.action) && c.fields.length === 0);
}

export const endsWithEachRule: StoreContractCase = {
  name: 'the scenario in order ends with each rule applied',
  async run(target) {
    const s = await scenario();
    const end = await run(target, s, s.events);
    const acme = Object.fromEntries(
      end.memberships
        .filter((m) => s.nameOf(m.companyId) === 'c-acme')
        .map((m) => [
          m.user,
          {
            role: m.role,
            granted: m.grantedRole,
            status: m.status,
            inv: m.invitationId && s.nameOf(m.invitationId),
          },
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
    expect(end.memberships.find((m) => m.user === 'u_owner')?.providerRole).toBe('org:member');
    const globex = end.memberships.filter((m) => s.nameOf(m.companyId) === 'c-globex');
    expect(globex.map((m) => m.user)).toEqual(['u_other']);

    const invitations = Object.fromEntries(
      end.invitations.map((i) => [s.nameOf(i.id), `${i.status}:${i.acceptedBy ?? '-'}`]),
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
    expect(end.invitations.find((i) => s.nameOf(i.id) === 'inv-ivan')?.externalInvitationId).not.toBeNull();
    const users = Object.fromEntries(end.users.map((u) => [u.subject, u.status]));
    expect(users).toMatchObject({ u_frank: 'deactivated', u_bob: 'active', u_erin: 'active' });
    expect(end.users.find((u) => u.subject === 'u_bob')?.displayName).toBe('Bob B.');
    expect(end.deferred).toEqual({});
  },
};

export const endsLikeTheReference: StoreContractCase = {
  name: 'the scenario in order ends exactly where the in-memory reference store ends, marks included',
  async run(target) {
    const s = await scenario();
    const reference = memorySeedableStore();
    await s.seed(reference);
    await applyAll(s.events, reference.store, s.ctx);
    expect(await run(target, s, s.events)).toEqual(await reference.snapshot());
  },
};

export const convergesShuffled: StoreContractCase = {
  name: 'seeded shuffles of the scenario all end in the same store',
  async run(target, settings) {
    const s = await scenario();
    const inOrder = await run(target, s, s.events);
    const random = seededRandom(20261103);
    for (let i = 0; i < settings.shuffles; i++) {
      expect(await run(target, s, shuffled(s.events, random)), `shuffle ${i}`).toEqual(inOrder);
    }
  },
};

export const convergesTwice: StoreContractCase = {
  name: 'every event delivered twice, shuffled, ends in the same store',
  async run(target, settings) {
    const s = await scenario();
    const inOrder = await run(target, s, s.events);
    const random = seededRandom(7);
    for (let i = 0; i < settings.doubles; i++) {
      expect(await run(target, s, shuffled([...s.events, ...s.events], random)), `run ${i}`).toEqual(inOrder);
    }
  },
};

export const repeatsAreNoops: StoreContractCase = {
  name: 'a second application of every event changes nothing',
  async run(target) {
    const s = await scenario();
    const fresh = await target.fresh();
    await s.seed(fresh);
    await applyAll(s.events, fresh.store, s.ctx);
    const before = await fresh.snapshot();
    for (const event of shuffled(s.events, seededRandom(1))) {
      const changes = await applyAll([event], fresh.store, s.ctx);
      expect(noop(changes), `${event.type} ${event.externalEventId}: ${JSON.stringify(changes)}`).toBe(true);
    }
    expect(await fresh.snapshot()).toEqual(before);
  },
};

export const convergesForOnePerson: StoreContractCase = {
  name: "orders of one person's join, promotion, rename and removal all end the same",
  async run(target, settings) {
    const history = await buildPersonHistory();
    expect(history.events.map((e) => e.type)).toEqual([
      'user.upserted',
      'invitation.accepted',
      'membership.upserted',
      'membership.upserted',
      'user.upserted',
      'membership.deleted',
    ]);
    const all = [...permutations(history.events)];
    // An even spread over the 720 orders (all of them when `orders` allows).
    const step = Math.max(1, Math.floor(all.length / Math.max(1, settings.orders)));
    const results = new Set<string>();
    let last: IdentitySnapshot | undefined;
    for (let i = 0; i < all.length && results.size <= 1; i += step) {
      const fresh = await target.fresh();
      await history.seed(fresh);
      await applyAll(all[i] ?? [], fresh.store, history.ctx);
      last = await fresh.snapshot();
      results.add(JSON.stringify(last));
    }
    expect(results.size).toBe(1);
    expect(last?.memberships).toMatchObject([
      { user: 'u_bob', status: 'removed', role: 'admin', grantedRole: 'viewer', providerRole: 'org:admin' },
    ]);
    expect(last?.users).toMatchObject([{ subject: 'u_bob', displayName: 'Bob', status: 'active' }]);
  },
};

export const CONVERGENCE_CASES: readonly StoreContractCase[] = [
  endsWithEachRule,
  endsLikeTheReference,
  convergesShuffled,
  convergesTwice,
  repeatsAreNoops,
  convergesForOnePerson,
];
