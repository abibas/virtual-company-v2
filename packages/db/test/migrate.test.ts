import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { queryRows } from '../src/handle.ts';
import { type DbHandle, migrateToLatest, migrationStatus } from '../src/migrate.ts';
import { createTestDb, type TestDb, testDbKind } from '../src/testing.ts';
import { journal, migrateUpTo } from './fixtures/migrations.ts';

async function appliedCount(handle: DbHandle): Promise<number> {
  const [row] = await queryRows<{ n: number }>(
    handle,
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  return row?.n ?? -1;
}

describe(`migrateToLatest on ${testDbKind()}`, () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });
  const fresh = async () => {
    testDb = await createTestDb();
    return testDb.handle;
  };

  it('starts from 0000_init', () => {
    expect(journal.entries[0]?.tag).toBe('0000_init');
  });

  it('creates the tables on a fresh database and records every migration', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    const tables = await queryRows<{ table_name: string }>(
      handle,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual([
      'access_profiles',
      'agent_placements',
      'agents',
      'api_keys',
      'audit_log',
      'chat_events',
      'chat_turns',
      'chats',
      'companies',
      'company_logos',
      'credential_uses',
      'credentials',
      'enrollment_tokens',
      'identity_events',
      'identity_marks',
      'identity_outbox',
      'identity_parked_events',
      'invitations',
      'machine_logos',
      'machine_power',
      'machine_power_events',
      'machine_samples',
      'machines',
      'memberships',
      'org_positions',
      'principals',
      'runner_sessions',
      'user_identities',
      'users',
    ]);
    expect(await appliedCount(handle)).toBe(journal.entries.length);
  });

  it('is a no-op the second time', async () => {
    const handle = await fresh();
    await migrateToLatest(handle);
    const first = await appliedCount(handle);
    await expect(migrateToLatest(handle)).resolves.toBeUndefined();
    expect(await appliedCount(handle)).toBe(first);
  });

  it('fails clearly for a folder without migrations', async () => {
    const handle = await fresh();
    await expect(migrateToLatest(handle, { migrationsFolder: '/nonexistent/migrations' })).rejects.toThrow(
      /journal/i,
    );
  });

  it('takes a database at 0000_init with data to the latest migration, keeping the rows', async () => {
    const handle = await fresh();
    // Only 0000_init, as the repository was before S1.3.
    await migrateUpTo(handle, '0000_init');
    expect(await migrationStatus(handle)).toMatchObject({ applied: 1, last: '0000_init', current: false });
    await queryRows(
      handle,
      sql`insert into users (id, primary_email, display_name)
      values ('0190f5f0-0000-7000-8000-000000000001', 'ihor@x.test', 'Ihor')`,
    );
    await queryRows(
      handle,
      sql`insert into companies (id, slug, name, created_by_user_id)
      values ('0190f5f0-0000-7000-8000-0000000000c1', 'acme', 'Acme', '0190f5f0-0000-7000-8000-000000000001')`,
    );

    await migrateToLatest(handle);
    expect(await migrationStatus(handle)).toMatchObject({
      applied: journal.entries.length,
      last: journal.entries.at(-1)?.tag,
      current: true,
    });
    const [kept] = await queryRows<{ slug: string; email: string }>(
      handle,
      sql`select c.slug, u.primary_email as email from companies c join users u on u.id = c.created_by_user_id`,
    );
    expect(kept).toEqual({ slug: 'acme', email: 'ihor@x.test' });
    // 0001 drops the unique email: a second person with the same email is another user now.
    await queryRows(
      handle,
      sql`insert into users (id, primary_email, display_name)
      values ('0190f5f0-0000-7000-8000-000000000002', 'ihor@x.test', 'Ihor again')`,
    );
    const [principal] = await queryRows<{ id: string }>(
      handle,
      sql`insert into principals (id, company_id, kind)
        values ('0190f5f0-0000-7000-8000-0000000000a1', '0190f5f0-0000-7000-8000-0000000000c1', 'person') returning id`,
    );
    expect(principal?.id).toBe('0190f5f0-0000-7000-8000-0000000000a1');
  });
});
