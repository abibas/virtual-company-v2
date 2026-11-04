import { describe, expect, it } from 'vitest';
import { IdentityProviderError, isIdentityProviderError } from '../src/errors.ts';
import type { FakeMethod } from '../src/fake.ts';
import { InMemoryIdentityStore } from '../src/memory-store.ts';
import type { ProjectionChange } from '../src/projector.ts';
import { reconcileOrganization, reconcileUser } from '../src/reconcile.ts';
import { acmeWorld, applyAll, world } from './fixtures/world.ts';

// The scenario's reconcile paths (both reconciles, each alone, against the webhooks) are cases of the
// IdentityStore contract (@mwc/testkit/store-contract), so every store runs them.

const NOW = Date.UTC(2026, 10, 4, 9);
const now = () => new Date(NOW);

function actions(changes: readonly ProjectionChange[]): string[] {
  return changes.map((c) => `${c.entity}:${c.action}${c.reason ? `:${c.reason}` : ''}`);
}

describe('reconcileOrganization', () => {
  it('projects members, invitations and lost removals, and summarizes them', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.join('u_carol', 'admin');
    await w.apply();
    await w.fake.removeMember(w.org.externalId, 'u_carol');
    await w.fake.revokeInvitation(w.org.externalId, await w.invite('inv-gina', 'gina@x.test', 'member'));
    w.fake.drainEvents(); // the webhooks never arrive

    const summary = await reconcileOrganization(w.org.externalId, w.fake, w.store, { now });
    expect(summary).toMatchObject({ members: 2, invitations: 3, removed: 1 });
    expect(actions(summary.changes)).toEqual([
      'membership:updated', // the owner's row learns its provider membership
      'membership:ignored:not_newer',
      'invitation:ignored:already_accepted',
      'invitation:ignored:already_accepted',
      'invitation:revoked',
      'membership:removed:provider_deleted',
    ]);
    expect((await w.membership('u_carol'))?.status).toBe('removed');
    expect(summary.changes.every((c) => c.eventId.startsWith('reconcile:'))).toBe(true);
    expect(summary.changes.at(-1)?.eventId).toBe(
      `reconcile:membership.deleted:${(await w.membership('u_carol'))?.externalMembershipId}`,
    );

    const again = await reconcileOrganization(w.org.externalId, w.fake, w.store, { now });
    expect(again).toMatchObject({ members: 2, invitations: 3, removed: 0 });
    expect(again.changes.every((c) => c.action === 'ignored')).toBe(true);
  });

  it('fetches members it has not seen and replays events parked until the company was linked', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'one@x.test' });
    const org = await fake.createOrganization({ name: 'Acme', metadata: {}, createdBySubject: 'u1' });
    const parked = fake.drainEvents().filter((e) => e.type === 'membership.upserted');
    expect(actions(await applyAll(parked, store, ctx))).toEqual(['membership:deferred:unknown_company']);

    store.addCompany({ id: 'c1', identityOrgExternalId: org.externalId });
    const summary = await reconcileOrganization(org.externalId, fake, store);
    // The parked upsert replays first: its user is unknown, so it parks again under the user; the listed
    // member then brings the user, which replays it, and the listed state itself is refused (no invitation).
    expect(actions(summary.changes)).toEqual([
      'membership:deferred:unknown_user',
      'user:created',
      'membership:refused:unlinked',
      'membership:refused:unlinked',
    ]);
    expect(store.snapshot().deferred).toEqual({});
    expect(summary.changes[0]?.eventId).toBe(parked[0]?.externalEventId);
  });

  it('does nothing, and asks the provider nothing, for an organization no company is linked to', async () => {
    const { fake } = world();
    fake.failNext('listOrganizationMembers');
    expect(await reconcileOrganization('org_404', fake, new InMemoryIdentityStore())).toEqual({
      members: 0,
      invitations: 0,
      removed: 0,
      changes: [],
    });
  });
});

describe('reconcileUser', () => {
  it('projects the person and their memberships in known companies, and removals the provider made', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    const globex = await w.fake.createOrganization({ name: 'Globex', metadata: {} });
    w.fake.addMember(globex.externalId, 'u_bob', 'org:member');
    w.fake.drainEvents();

    const first = await reconcileUser('u_bob', w.fake, w.store, { now });
    expect(first).toMatchObject({ members: 1, invitations: 0, removed: 0 });
    expect(actions(first.changes)).toEqual(['user:created', 'invitation:accepted', 'membership:created']);

    await w.fake.removeMember(w.org.externalId, 'u_bob');
    w.fake.drainEvents();
    const second = await reconcileUser('u_bob', w.fake, w.store, { now });
    expect(second).toMatchObject({ members: 0, removed: 1 });
    expect(actions(second.changes)).toEqual([
      'user:ignored:not_newer',
      'membership:removed:provider_deleted',
    ]);
    expect((await w.membership('u_bob'))?.status).toBe('removed');
  });

  it('never removes a row made here that has no provider membership yet; the creator row adopts its own', async () => {
    const w = await acmeWorld();
    const pat = w.fake.createUser({ subject: 'u_pat', email: 'pat@x.test' });
    const row = w.store.addUser({
      issuer: w.ctx.issuer,
      subject: pat.subject,
      primaryEmail: pat.primaryEmail,
      displayName: pat.displayName,
    });
    w.store.addMembership({ companyId: w.company.id, userId: row.id, role: 'member' });
    w.fake.drainEvents();
    expect(await reconcileUser('u_pat', w.fake, w.store, { now })).toMatchObject({ members: 0, removed: 0 });
    expect((await w.membership('u_pat'))?.status).toBe('active');

    const owner = await reconcileUser('u_owner', w.fake, w.store, { now });
    expect(owner).toMatchObject({ members: 1, removed: 0 });
    expect(actions(owner.changes)).toEqual(['membership:updated']);
    expect(await w.membership('u_owner')).toMatchObject({ role: 'owner', providerRole: 'org:admin' });
  });

  it('projects a person the provider no longer has as deleted, and ignores one never seen', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.apply();
    w.fake.deleteUser('u_bob');
    w.fake.drainEvents();
    const summary = await reconcileUser('u_bob', w.fake, w.store, { now });
    expect(actions(summary.changes)).toEqual(['user:deactivated', 'membership:removed:user_deleted']);
    expect(summary.changes[0]?.eventId).toBe('reconcile:user.deleted:u_bob');
    expect(await reconcileUser('u_nobody', w.fake, w.store)).toEqual({
      members: 0,
      invitations: 0,
      removed: 0,
      changes: [],
    });
  });
});

describe('provider failures', () => {
  it.each<[string, FakeMethod]>([
    ['reconcileOrganization', 'listOrganizationMembers'],
    ['reconcileOrganization', 'getUser'],
    ['reconcileOrganization', 'listInvitations'],
    ['reconcileUser', 'getUser'],
    ['reconcileUser', 'listUserOrganizations'],
  ])('%s rejects with the IdentityProviderError of %s', async (run, method) => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    w.fake.addMember(w.org.externalId, 'u_bob', 'org:member');
    const error = new IdentityProviderError('rate_limited', 'slow down', { retryAfterMs: 2000 });
    w.fake.failNext(method, error);
    const call =
      run === 'reconcileOrganization'
        ? reconcileOrganization(w.org.externalId, w.fake, w.store, { now })
        : reconcileUser('u_bob', w.fake, w.store, { now });
    const rejected = await call.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejected).toBe(error);
    expect(isIdentityProviderError(rejected, 'rate_limited')).toBe(true);
    expect((rejected as IdentityProviderError).retryAfterMs).toBe(2000);
  });
});
