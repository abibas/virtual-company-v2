/**
 * The database store under the IdentityStore contract (@mwc/testkit/store-contract): one migrated test
 * database (PGlite, or Postgres with TEST_DB=postgres) whose identity tables `fresh()` empties, seeding
 * straight into the tables, and a snapshot read back through the in-memory store so both compare equal.
 */
import {
  companies,
  identityMarks,
  identityParkedEvents,
  invitations,
  memberships,
  userIdentities,
  users,
} from '@mwc/db';
import { type DbHandle, migrateToLatest, queryRows, rawDb } from '@mwc/db/system';
import { InMemoryIdentityStore } from '@mwc/identity-core/memory-store';
import { newId } from '@mwc/shared/ids';
import { createTestDb, type TestDb } from '@mwc/testkit';
import type { IdentitySnapshot, SeedableStore, StoreContractTarget } from '@mwc/testkit/store-contract';
import { asc, eq, sql } from 'drizzle-orm';
import { type DbIdentityStore, dbIdentityStore } from '../../../src/modules/identity/repo.ts';
import { testChart } from '../org.ts';

/** The provider kind of the fake (`FakeIdentityProvider.kind`): what the contract's scenarios use. */
export const PROVIDER = 'fake';

const TABLES = sql.raw(
  [
    'identity_parked_events',
    'identity_marks',
    'identity_outbox',
    'identity_events',
    'api_keys',
    'audit_log',
    'memberships',
    'invitations',
    'principals',
    'user_identities',
    'companies',
    'users',
  ].join(', '),
);

/** Every identity table emptied, so the next case starts from nothing. */
export async function emptyIdentityTables(handle: DbHandle): Promise<void> {
  await queryRows(handle, sql`truncate table ${TABLES} restart identity cascade`);
}

/** The database's identity state in the in-memory store's snapshot shape (users by their identity here). */
export async function snapshotOf(handle: DbHandle): Promise<IdentitySnapshot> {
  const db = rawDb(handle);
  const memory = new InMemoryIdentityStore();
  for (const c of await db.select().from(companies)) {
    memory.addCompany({ id: c.id, identityOrgExternalId: c.identityOrgId, status: c.status });
  }
  const people = await db
    .select({ user: users, identity: userIdentities })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(eq(userIdentities.provider, PROVIDER));
  for (const { user, identity } of people)
    memory.addUser({ ...user, issuer: identity.issuer, subject: identity.subject });
  // A membership's default access profiles (S3.4) are the org module's, not the identity store's.
  for (const {
    id: _id,
    principalId: _p,
    createdAt: _c,
    updatedAt: _u,
    defaultClaudeProfileId: _dc,
    defaultOpenaiProfileId: _do,
    ...m
  } of await db.select().from(memberships)) {
    await memory.upsertMembership(m);
  }
  for (const i of await db.select().from(invitations)) {
    memory.addInvitation({ ...i, email: i.emailNormalized });
    if (i.acceptedByUserId) await memory.updateInvitation(i.id, { acceptedByUserId: i.acceptedByUserId });
  }
  for (const mark of await db.select().from(identityMarks)) {
    await memory.setMark(mark.key, { at: mark.providerUpdatedAtMs, deleted: mark.deleted });
  }
  for (const parked of await db.select().from(identityParkedEvents).orderBy(asc(identityParkedEvents.id))) {
    await memory.defer(parked.key, parked.event);
  }
  return memory.snapshot();
}

/** A seedable database store on `handle` (seeds go straight into the tables, as the services will make them). */
export function seedableDbStore(
  handle: DbHandle,
  store: DbIdentityStore = dbIdentityStore(handle, { provider: PROVIDER, chart: testChart() }),
): SeedableStore {
  const db = rawDb(handle);
  return {
    store,
    async addCompany(input) {
      const id = input.id ?? newId();
      await db.insert(companies).values({
        id,
        slug: `c-${id}`,
        name: `Company ${id.slice(0, 8)}`,
        status: input.status ?? 'active',
        identityOrgId: input.identityOrgExternalId,
      });
      return { id, identityOrgExternalId: input.identityOrgExternalId, status: input.status ?? 'active' };
    },
    addUser: (input) =>
      store.upsertUser({
        ...input,
        primaryEmail: input.primaryEmail.toLowerCase(),
        imageUrl: input.imageUrl ?? null,
        status: input.status ?? 'active',
      }),
    addMembership: (input) =>
      store.upsertMembership({
        companyId: input.companyId,
        userId: input.userId,
        role: input.role,
        grantedRole: input.role,
        status: input.status ?? 'active',
        externalMembershipId: input.externalMembershipId ?? null,
        providerRole: input.providerRole ?? null,
        invitationId: input.invitationId ?? null,
      }),
    async addInvitation(input) {
      const id = input.id ?? newId();
      await db.insert(invitations).values({
        id,
        companyId: input.companyId,
        emailNormalized: input.email.toLowerCase(),
        role: input.role,
        status: input.status ?? 'pending',
        externalInvitationId: input.externalInvitationId ?? null,
        expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      });
      const invitation = await store.getInvitation(id);
      if (!invitation) throw new Error(`invitation ${id} was not stored`);
      return invitation;
    },
    snapshot: () => snapshotOf(handle),
  };
}

/** The contract's target: one migrated test database for all the cases, emptied by each `fresh()`. */
export function dbStoreTarget(): StoreContractTarget {
  let testDb: TestDb | undefined;
  return {
    async fresh() {
      if (!testDb) {
        testDb = await createTestDb();
        await migrateToLatest(testDb.handle);
      } else {
        await emptyIdentityTables(testDb.handle);
      }
      return seedableDbStore(testDb.handle);
    },
    cleanup: async () => testDb?.close(),
  };
}
