import { identityParkedEvents, memberships, principals, userIdentities } from '@mwc/db';
import { migrateToLatest, rawDb } from '@mwc/db/system';
import { project } from '@mwc/identity-core';
import { buildScenario } from '@mwc/identity-core/scenario';
import { createTestDb, type TestDb } from '@mwc/testkit';
import { describeStoreContract } from '@mwc/testkit/store-contract';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DbIdentityStore, dbIdentityStore } from '../../../src/modules/identity/repo.ts';
import {
  dbStoreTarget,
  emptyIdentityTables,
  PROVIDER,
  seedableDbStore,
  snapshotOf,
} from '../../fixtures/identity/identity-store.ts';
import { testChart } from '../../fixtures/org.ts';

// The same contract the in-memory store passes (packages/testkit/test/store-contract.test.ts), on the
// database: fewer convergence runs, since each one empties and seeds the tables again.
describeStoreContract(`DbIdentityStore on ${process.env.TEST_DB ?? 'pglite'}`, dbStoreTarget, {
  shuffles: 8,
  doubles: 3,
  orders: 24,
  timeoutMs: 60_000,
});

describe('DbIdentityStore on the tables', () => {
  let testDb: TestDb;
  let store: DbIdentityStore;
  beforeAll(async () => {
    testDb = await createTestDb();
    await migrateToLatest(testDb.handle);
    store = dbIdentityStore(testDb.handle, { provider: PROVIDER, chart: testChart() });
  });
  beforeEach(() => emptyIdentityTables(testDb.handle));
  afterAll(() => testDb.close());

  const person = (subject: string, issuer = 'https://issuer.test') => ({
    issuer,
    subject,
    primaryEmail: `${subject}@x.test`,
    displayName: subject,
    imageUrl: null,
    status: 'active' as const,
  });

  it('gives each new membership its own person principal in that company, and keeps it on update', async () => {
    const seed = seedableDbStore(testDb.handle, store);
    const acme = await seed.addCompany({ identityOrgExternalId: 'org_1' });
    const bob = await store.upsertUser(person('bob'));
    const created = await seed.addMembership({ companyId: acme.id, userId: bob.id, role: 'member' });
    await store.upsertMembership({ ...created, status: 'removed' });
    const db = rawDb(testDb.handle);
    const [row] = await db.select().from(memberships).where(eq(memberships.id, created.id));
    const [principal] = await db
      .select()
      .from(principals)
      .where(eq(principals.id, row?.principalId ?? ''));
    expect(principal).toMatchObject({ companyId: acme.id, kind: 'person' });
    expect(row?.status).toBe('removed');
    expect(await db.select().from(principals)).toHaveLength(1);
  });

  it('records the provider of a new identity, and reads a user by id through this provider', async () => {
    const bob = await store.upsertUser(person('bob'));
    const db = rawDb(testDb.handle);
    expect(await db.select().from(userIdentities)).toMatchObject([{ userId: bob.id, provider: PROVIDER }]);
    // The same person signing in through another provider: that store sees them by its own identity.
    await db
      .insert(userIdentities)
      .values({ userId: bob.id, provider: 'oidc', issuer: 'https://idp.test', subject: 'b-1' });
    expect(await store.getUserById(bob.id)).toMatchObject({ issuer: 'https://issuer.test', subject: 'bob' });
    const oidc = dbIdentityStore(testDb.handle, { provider: 'oidc', chart: testChart() });
    expect(await oidc.getUserById(bob.id)).toMatchObject({ issuer: 'https://idp.test', subject: 'b-1' });
    const clerk = dbIdentityStore(testDb.handle, { provider: 'clerk', chart: testChart() });
    expect(await clerk.getUserById(bob.id)).toBeUndefined();
  });

  it('projects an event in one transaction: an error rolls back everything it wrote', async () => {
    const scenario = await buildScenario();
    await scenario.seed(seedableDbStore(testDb.handle, store));
    const before = await snapshotOf(testDb.handle);
    // Bob signing up: the event creates a user (and replays nothing).
    const first = scenario.events.find((e) => e.type === 'user.upserted' && e.data.subject === 'u_bob');
    if (!first) throw new Error('no sign-up of u_bob');
    const failed = store.transaction(async (tx) => {
      await project(first, tx, scenario.ctx);
      await tx.defer('org:x', first);
      throw new Error('the inbox failed after projecting');
    });
    await expect(failed).rejects.toThrow('the inbox failed after projecting');
    expect(await snapshotOf(testDb.handle)).toEqual(before);

    const changes = await store.transaction((tx) => project(first, tx, scenario.ctx));
    expect(changes.map((c) => `${c.entity}:${c.action}`)).toEqual(['user:created']);
    expect((await snapshotOf(testDb.handle)).users.map((u) => u.subject)).toContain('u_bob');
  });

  it('keeps parked events as jsonb, whole', async () => {
    const scenario = await buildScenario();
    const event = scenario.events.find((e) => e.type === 'membership.upserted');
    if (!event) throw new Error('no membership event');
    await store.defer('user:x', event);
    const [row] = await rawDb(testDb.handle).select().from(identityParkedEvents);
    expect(row?.event).toEqual(event);
    expect(await store.takeDeferred('user:x')).toEqual([event]);
  });
});
