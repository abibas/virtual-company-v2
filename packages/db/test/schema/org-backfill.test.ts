import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { type Membership, orgPositions } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { insertCompany, insertPrincipal, insertUser } from '../fixtures/rows.ts';

/**
 * The data step of migration `0005_org` (the `-- custom:` part of `migrations/0005_org.sql`): every company's active
 * memberships get a position in `org_positions`, owners at the root and everyone else under the company's earliest
 * active owner. The rows are seeded at `0004_company_logos`, before the org tables existed.
 */

let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0004_company_logos');
});
afterAll(() => testDb.close());

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

/**
 * A membership with the role (granted too), status and joining day given, written with the columns `memberships` had
 * at `0004` (a later one, as S3.4's `default_profile_id`, does not exist yet).
 */
async function member(
  companyId: string,
  role: Membership['role'],
  joined: number,
  status: Membership['status'] = 'active',
): Promise<string> {
  const user = await insertUser(handle);
  const principal = await insertPrincipal(handle, companyId);
  await queryRows(
    handle,
    sql`insert into memberships (id, company_id, principal_id, user_id, role, granted_role, status, created_at)
        values (${newId()}, ${companyId}, ${principal.id}, ${user.id}, ${role}, ${role}, ${status},
                ${day(joined).toISOString()})`,
  );
  return principal.id;
}

describe(`0005_org on ${testDbKind()}: existing members placed on the chart`, () => {
  let positions: Map<string, string | null>;
  const seeded: Record<string, string> = {};
  let companies: { acme: string; globex: string; ownerless: string; empty: string; tied: string };

  beforeAll(async () => {
    companies = {
      acme: (await insertCompany(handle)).id,
      globex: (await insertCompany(handle)).id,
      ownerless: (await insertCompany(handle)).id,
      empty: (await insertCompany(handle, { status: 'provisioning' })).id,
      tied: (await insertCompany(handle)).id,
    };
    const { acme, globex, ownerless, tied } = companies;
    // Acme: a suspended owner joined first, so the first active owner is the one who joined next.
    seeded.suspendedOwner = await member(acme, 'owner', 1, 'suspended');
    seeded.firstOwner = await member(acme, 'owner', 2);
    seeded.secondOwner = await member(acme, 'owner', 3);
    seeded.admin = await member(acme, 'admin', 4);
    seeded.member = await member(acme, 'member', 5);
    seeded.viewer = await member(acme, 'viewer', 6);
    seeded.invited = await member(acme, 'member', 7, 'invited');
    seeded.removed = await member(acme, 'admin', 8, 'removed');
    seeded.suspended = await member(acme, 'member', 9, 'suspended');
    // An agent principal from before the org tables has no membership, so no position either.
    seeded.agent = (await insertPrincipal(handle, acme, 'agent')).id;
    // Globex: its members report to its own owner, never to Acme's.
    seeded.globexOwner = await member(globex, 'owner', 10);
    seeded.globexMember = await member(globex, 'member', 1);
    // No active owner: its active members sit at the root.
    seeded.ownerlessOwner = await member(ownerless, 'owner', 1, 'removed');
    seeded.ownerlessMember = await member(ownerless, 'admin', 2);
    // Two owners who joined at the same time: the earlier id (UUID v7, made first) is the first owner.
    seeded.tiedFirst = await member(tied, 'owner', 1);
    seeded.tiedSecond = await member(tied, 'owner', 1);
    seeded.tiedMember = await member(tied, 'member', 2);

    await migrateToLatest(handle);
    const rows = await handle.db.select().from(orgPositions);
    expect(rows.every((row) => row.title === null)).toBe(true);
    positions = new Map(rows.map((row) => [row.principalId, row.reportsToPrincipalId]));
  });

  it('applies the migration (and the ones after it)', async () => {
    expect(await migrationStatus(handle)).toMatchObject({ last: journal.entries.at(-1)?.tag, current: true });
  });

  it("puts owners at the root and everyone else under the company's earliest active owner", () => {
    expect(positions.get(seeded.firstOwner ?? '')).toBeNull();
    expect(positions.get(seeded.secondOwner ?? '')).toBeNull();
    for (const name of ['admin', 'member', 'viewer']) {
      expect(positions.get(seeded[name] ?? ''), name).toBe(seeded.firstOwner);
    }
    expect(positions.get(seeded.globexOwner ?? '')).toBeNull();
    expect(positions.get(seeded.globexMember ?? '')).toBe(seeded.globexOwner);
  });

  it('places nobody whose membership is not active, and no principal without a membership', () => {
    for (const name of ['suspendedOwner', 'invited', 'removed', 'suspended', 'agent', 'ownerlessOwner']) {
      expect(positions.has(seeded[name] ?? ''), name).toBe(false);
    }
  });

  it('puts the active members of a company without an active owner at the root', () => {
    expect(positions.has(seeded.ownerlessMember ?? '')).toBe(true);
    expect(positions.get(seeded.ownerlessMember ?? '')).toBeNull();
  });

  it('breaks a tie between owners who joined at the same time by id', () => {
    expect([seeded.tiedFirst, seeded.tiedSecond].map((id) => positions.get(id ?? ''))).toEqual([null, null]);
    expect(positions.get(seeded.tiedMember ?? '')).toBe(seeded.tiedFirst);
  });

  it('places exactly the active memberships, and none in a company without members', async () => {
    const rows = await handle.db.select().from(orgPositions);
    expect(rows.filter((row) => row.companyId === companies.empty)).toEqual([]);
    expect(rows.filter((row) => row.companyId === companies.acme)).toHaveLength(5);
    // Acme 5, Globex 2, the ownerless company 1, the tied one 3.
    expect(rows).toHaveLength(11);
  });
});
