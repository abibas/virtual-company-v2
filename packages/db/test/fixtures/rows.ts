/**
 * Rows for the schema and tenant tests, inserted straight through Drizzle on a migrated test database
 * (PGlite, or Postgres with TEST_DB=postgres). Every name is unique per process, so tests can share one
 * database.
 */
import { randomBytes } from 'node:crypto';
import type { RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import {
  type Agent,
  agents,
  type Company,
  companies,
  type Invitation,
  invitations,
  type Machine,
  type Membership,
  machines,
  memberships,
  type NewAgent,
  type NewCompany,
  type NewInvitation,
  type NewMachine,
  type Principal,
  principals,
  type User,
  users,
} from '../../src/schema/index.ts';
import { createTestDb, type TestDb } from '../../src/testing.ts';

export async function migratedTestDb(): Promise<TestDb> {
  const testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
  return testDb;
}

let seq = 0;
const run = randomBytes(3).toString('hex');
/** `<prefix>-<n>-<run>`: unique in this process and across runs on one Postgres. */
export const unique = (prefix: string) => `${prefix}-${++seq}-${run}`;

/** Fourteen days from now: an invitation's usual expiry. */
export const inTwoWeeks = () => new Date(Date.now() + 14 * 24 * 3600 * 1000);

/** A well-formed id that no row has. */
export const MISSING_ID = '0190f5f0-0000-7000-8000-000000000000';

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('no row returned');
  return row;
}

export async function insertCompany(handle: RawDbHandle, values: Partial<NewCompany> = {}): Promise<Company> {
  const slug = unique('co');
  return one(
    await handle.db
      .insert(companies)
      .values({ slug, name: slug, status: 'active', ...values })
      .returning(),
  );
}

export async function insertUser(handle: RawDbHandle, email = `${unique('user')}@x.test`): Promise<User> {
  return one(await handle.db.insert(users).values({ primaryEmail: email, displayName: 'U' }).returning());
}

export async function insertPrincipal(
  handle: RawDbHandle,
  companyId: string,
  kind: Principal['kind'] = 'person',
): Promise<Principal> {
  return one(await handle.db.insert(principals).values({ companyId, kind }).returning());
}

export async function insertInvitation(
  handle: RawDbHandle,
  companyId: string,
  values: Partial<NewInvitation> = {},
): Promise<Invitation> {
  return one(
    await handle.db
      .insert(invitations)
      .values({
        companyId,
        emailNormalized: `${unique('inv')}@x.test`,
        role: 'member',
        expiresAt: inTwoWeeks(),
        ...values,
      })
      .returning(),
  );
}

/** A person in a company: a new user (unless given), their principal there and an active membership. */
export async function insertMember(
  handle: RawDbHandle,
  companyId: string,
  values: Partial<typeof memberships.$inferInsert> = {},
): Promise<{ user: User; principal: Principal; membership: Membership }> {
  const user = values.userId ? undefined : await insertUser(handle);
  const principal = await insertPrincipal(handle, companyId);
  const membership = one(
    await handle.db
      .insert(memberships)
      .values({
        companyId,
        principalId: principal.id,
        userId: user?.id ?? (values.userId as string),
        role: 'member',
        grantedRole: 'member',
        ...values,
      })
      .returning(),
  );
  return { user: user ?? ({ id: membership.userId } as User), principal, membership };
}

/** An agent in a company, on a new agent principal there unless one is given; its name and slug are unique. */
export async function insertAgent(
  handle: RawDbHandle,
  companyId: string,
  values: Partial<NewAgent> = {},
): Promise<Agent> {
  const principalId = values.principalId ?? (await insertPrincipal(handle, companyId, 'agent')).id;
  const slug = unique('agent');
  return one(
    await handle.db
      .insert(agents)
      .values({
        companyId,
        principalId,
        name: slug,
        slug,
        roleTitle: 'Coder',
        model: 'claude-opus-5-5',
        ...values,
      })
      .returning(),
  );
}

/** A machine in a company (a laptop with no provider, offline), its name unique unless given. */
export async function insertMachine(
  handle: RawDbHandle,
  companyId: string,
  values: Partial<NewMachine> = {},
): Promise<Machine> {
  return one(
    await handle.db
      .insert(machines)
      .values({
        companyId,
        name: unique('machine'),
        kind: 'laptop',
        os: 'darwin',
        arch: 'arm64',
        hostname: 'mac.local',
        unixUser: 'ihor',
        runnerVersion: '0.5.0',
        ...values,
      })
      .returning(),
  );
}
