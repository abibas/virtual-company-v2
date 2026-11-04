import { describe, expect, it } from 'vitest';
import { InMemoryIdentityStore } from '../../src/memory-store.ts';
import { project } from '../../src/projector.ts';
import { identityKeys } from '../../src/store.ts';
import type { Event } from '../fixtures/events.ts';
import { actions, first, must, variant } from '../fixtures/events.ts';
import { acmeWorld, world } from '../fixtures/world.ts';

describe('user.upserted', () => {
  it('creates the user with a lower-cased email and reports every field', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test', displayName: 'Ann', imageUrl: 'https://i/a.png' });
    const event = first(fake.drainEvents(), 'user.upserted');
    const shouting = variant(event, { primaryEmail: 'Ann@X.Test' });
    expect(await project(shouting, store, ctx)).toEqual([
      {
        entity: 'user',
        action: 'created',
        id: expect.any(String),
        companyId: null,
        reason: null,
        eventId: shouting.externalEventId,
        fields: [
          { field: 'primaryEmail', old: null, new: 'ann@x.test' },
          { field: 'displayName', old: null, new: 'Ann' },
          { field: 'imageUrl', old: null, new: 'https://i/a.png' },
          { field: 'status', old: null, new: 'active' },
        ],
      },
    ]);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      primaryEmail: 'ann@x.test',
      status: 'active',
    });
  });

  it('applies a newer state with only the changed fields and ignores an equal or older one', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    fake.updateUser('u1', { displayName: 'Ann' });
    fake.updateUser('u1', { email: 'ann@x.test' });
    const [created, renamed, moved] = fake.drainEvents() as Event<'user.upserted'>[];
    await project(must(created), store, ctx);
    const changes = await project(must(moved), store, ctx);
    expect(actions(changes)).toEqual(['user:updated']);
    expect(changes[0]?.fields.map((f) => f.field)).toEqual(['primaryEmail', 'displayName']);
    expect(actions(await project(must(renamed), store, ctx))).toEqual(['user:ignored:not_newer']);
    expect(actions(await project(must(moved), store, ctx))).toEqual(['user:ignored:not_newer']);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      primaryEmail: 'ann@x.test',
      displayName: 'Ann',
    });

    // A newer state with the same fields moves the mark and reports nothing.
    const at = must(moved).data.updatedAt + 5;
    expect(await project(variant(must(moved), { updatedAt: at }), store, ctx)).toEqual([]);
    expect(await store.getMark(identityKeys.user(ctx.issuer, 'u1'))).toEqual({ at, deleted: false });
  });
});

describe('user.deleted', () => {
  it('deactivates the user and removes every membership they have', async () => {
    const w = await acmeWorld();
    await w.join('u_bob', 'member');
    await w.apply();
    const bob = must(await w.store.getUser(w.ctx.issuer, 'u_bob'));
    const globex = w.store.addCompany({ id: 'c-globex', identityOrgExternalId: 'org_elsewhere' });
    w.store.addMembership({ companyId: globex.id, userId: bob.id, role: 'viewer' });

    w.fake.deleteUser('u_bob');
    const events = w.fake.drainEvents();
    expect(events.map((e) => e.type)).toEqual(['membership.deleted', 'user.deleted']);
    const deleted = first(events, 'user.deleted');
    // The user's deletion alone (its membership's deletion lost) ends access everywhere.
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual([
      'user:deactivated',
      'membership:removed:user_deleted',
      'membership:removed:user_deleted',
    ]);
    expect((await w.store.getUser(w.ctx.issuer, 'u_bob'))?.status).toBe('deactivated');
    expect((await w.store.listMemberships({ userId: bob.id })).map((m) => m.status)).toEqual([
      'removed',
      'removed',
    ]);
    expect(actions(await project(deleted, w.store, w.ctx))).toEqual(['user:ignored:already_deleted']);
    expect(actions(await project(first(events, 'membership.deleted'), w.store, w.ctx))).toEqual([
      'membership:ignored:already_removed',
    ]);
  });

  it('is remembered for a user not seen yet, so their late upsert lands deactivated', async () => {
    const { fake, ctx } = world();
    const store = new InMemoryIdentityStore();
    fake.createUser({ subject: 'u1', email: 'a@x.test' });
    fake.deleteUser('u1');
    const events = fake.drainEvents();
    expect(actions(await project(first(events, 'user.deleted'), store, ctx))).toEqual([
      'user:ignored:unknown_user',
    ]);
    expect(actions(await project(first(events, 'user.upserted'), store, ctx))).toEqual(['user:created']);
    expect((await store.getUser(ctx.issuer, 'u1'))?.status).toBe('deactivated');
    // A later, newer profile change does not bring the user back either.
    const upserted = first(events, 'user.upserted');
    const later = variant(upserted, { displayName: 'Back', updatedAt: upserted.data.updatedAt + 1000 });
    expect(actions(await project(later, store, ctx))).toEqual(['user:updated']);
    expect(await store.getUser(ctx.issuer, 'u1')).toMatchObject({
      displayName: 'Back',
      status: 'deactivated',
    });
  });
});
