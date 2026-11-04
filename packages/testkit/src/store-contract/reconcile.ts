import { reconcileOrganization, reconcileUser } from '@mwc/identity-core';
import type { FakeIdentityProvider } from '@mwc/identity-core/fake';
import { applyAll, buildScenario, type Scenario } from '@mwc/identity-core/scenario';
import { expect } from 'vitest';
import { scenario } from './convergence.ts';
import type { IdentitySnapshot, StoreContractCase, StoreContractTarget } from './target.ts';

/**
 * Reconcile on the store: the scenario's provider history replayed step by step with reconciles instead
 * of webhooks must end in the store the webhooks give (the parts each reconcile owns).
 */

const NOW = Date.UTC(2026, 10, 4, 9);
const now = () => new Date(NOW);

type Rows = Omit<IdentitySnapshot, 'marks' | 'deferred'>;

/** The store's rows without the ordering bookkeeping (marks, parked events), for comparing paths. */
function rows(snapshot: IdentitySnapshot): Rows {
  const { marks: _marks, deferred: _deferred, ...entities } = snapshot;
  return entities;
}

async function webhooks(target: StoreContractTarget, s: Scenario): Promise<Rows> {
  const fresh = await target.fresh();
  await s.seed(fresh);
  await applyAll(s.events, fresh.store, s.ctx);
  return rows(await fresh.snapshot());
}

/**
 * The same history again, reconciling both companies (their organizations exist from the first step, with the
 * same ids on every build) and/or every person after each step.
 */
async function reconciled(
  target: StoreContractTarget,
  base: Scenario,
  what: { orgs: boolean; users: boolean },
): Promise<Rows> {
  const fresh = await target.fresh();
  await base.seed(fresh);
  await buildScenario(async (fake: FakeIdentityProvider) => {
    if (what.orgs) {
      for (const orgExternalId of base.orgs.values()) {
        await reconcileOrganization(orgExternalId, fake, fresh.store, { now });
      }
    }
    if (what.users) {
      for (const subject of base.subjects) await reconcileUser(subject, fake, fresh.store, { now });
    }
  });
  return rows(await fresh.snapshot());
}

export const reconcilesLikeWebhooks: StoreContractCase = {
  name: 'both reconciles after every step give the companies, users, memberships and invitations the webhooks give',
  async run(target) {
    const s = await scenario();
    expect(await reconciled(target, s, { orgs: true, users: true })).toEqual(await webhooks(target, s));
  },
};

export const reconcilesOrganizations: StoreContractCase = {
  name: 'the organization reconcile alone gives the memberships and invitations the webhooks give',
  async run(target) {
    const s = await scenario();
    const expected = await webhooks(target, s);
    const actual = await reconciled(target, s, { orgs: true, users: false });
    expect(actual.memberships).toEqual(expected.memberships);
    expect(actual.invitations).toEqual(expected.invitations);
    // Profile changes and account deletions of known people are the sign-in reconcile's (or the webhooks').
    expect(actual.users).not.toEqual(expected.users);
  },
};

export const reconcilesUsers: StoreContractCase = {
  name: 'the sign-in reconcile alone gives the people and memberships the webhooks give',
  async run(target) {
    const s = await scenario();
    const expected = await webhooks(target, s);
    const actual = await reconciled(target, s, { orgs: false, users: true });
    expect(actual.users).toEqual(expected.users);
    expect(actual.memberships).toEqual(expected.memberships);
  },
};

export const RECONCILE_CASES: readonly StoreContractCase[] = [
  reconcilesLikeWebhooks,
  reconcilesOrganizations,
  reconcilesUsers,
];
