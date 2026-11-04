import type { MembershipRole, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { FAKE_ROLES } from '../src/fake.ts';
import { InMemoryIdentityStore } from '../src/memory-store.ts';
import { effectiveRole, project, projectionContext } from '../src/projector.ts';
import { identityKeys } from '../src/store.ts';
import { actions, first, must } from './fixtures/events.ts';
import { acmeWorld, world } from './fixtures/world.ts';

describe('projectionContext and effectiveRole', () => {
  it('takes the issuer and the role map from the provider', () => {
    const { fake, ctx } = world();
    expect(ctx).toEqual({ issuer: fake.issuer, roles: fake.roles });
    expect(projectionContext({ issuer: 'https://i', roles: FAKE_ROLES }).issuer).toBe('https://i');
  });

  it.each<[MembershipRole, string | null, MembershipRole]>([
    ['owner', 'org:member', 'owner'],
    ['owner', 'org:admin', 'owner'],
    ['owner', null, 'owner'],
    ['admin', 'org:member', 'admin'],
    ['member', 'org:admin', 'admin'],
    ['viewer', 'org:admin', 'admin'],
    ['member', 'org:member', 'member'],
    ['viewer', 'org:billing', 'viewer'],
    ['member', null, 'member'],
  ])('granted %s with provider role %s applies as %s', (granted, providerRole, expected) => {
    expect(effectiveRole(granted, providerRole, FAKE_ROLES)).toBe(expected);
  });
});

describe('org.upserted and org.deleted', () => {
  it('parks memberships of an organization no company is linked to, and replays them once one is', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    const org = await fake.createOrganization({ name: 'Acme', metadata: {}, createdBySubject: 'u1' });
    const events = fake.drainEvents();
    const orgEvent = first(events, 'org.upserted');
    const membership = first(events, 'membership.upserted');
    await project(first(events, 'user.upserted'), store, ctx);

    expect(actions(await project(membership, store, ctx))).toEqual(['membership:deferred:unknown_company']);
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['company:ignored:unknown_company']);
    expect(store.snapshot().deferred).toEqual({
      [identityKeys.org(org.externalId)]: [membership.externalEventId],
    });

    // The outbox links the company it created (S1.5); the creator's local owner row already exists.
    store.addCompany({ id: 'c1', identityOrgExternalId: null });
    store.linkCompany('c1', org.externalId);
    const user = must(await store.getUser(ctx.issuer, 'u1'));
    store.addMembership({ companyId: 'c1', userId: user.id, role: 'owner' });
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['membership:updated']);
    expect(await store.getMembership('c1', user.id)).toMatchObject({
      role: 'owner',
      status: 'active',
      externalMembershipId: membership.data.externalMembershipId,
      providerRole: 'org:admin',
    });
    expect(store.snapshot().deferred).toEqual({});
    expect(actions(await project(orgEvent, store, ctx))).toEqual(['company:ignored:company_is_local']);
  });

  it('ignores the deletion of an organization: companies are local', async () => {
    const w = await acmeWorld();
    await w.fake.deleteOrganization(w.org.externalId);
    const [deleted] = w.fake.drainEvents();
    const before = w.store.snapshot();
    const changes = await project(must(deleted), w.store, w.ctx);
    expect(changes).toMatchObject([{ entity: 'company', action: 'ignored', id: w.company.id }]);
    expect(actions(changes)).toEqual(['company:ignored:org_deleted_upstream']);
    expect(w.store.snapshot()).toEqual(before);
    const elsewhere = { ...must(deleted), data: { externalId: 'org_unknown' } } as NormalizedIdentityEvent;
    expect((await project(elsewhere, w.store, w.ctx))[0]?.id).toBeNull();
  });
});
