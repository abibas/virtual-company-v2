import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { insertUser } from '../fixtures/rows.ts';

/**
 * The data step of migration `0041_github_reviews` (`migrations/0041_github_reviews.sql`): every GitHub part stored
 * before gets `"reviews": "off"`, a part that already says `reviews` keeps it, and a profile with no GitHub part stays
 * without one. The rows are seeded at the migration before it.
 */

const MINE = journal.entries.findIndex((entry) => entry.tag.endsWith('_github_reviews'));
const BEFORE = (journal.entries[MINE - 1] as { tag: string }).tag;

let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, BEFORE);
});
afterAll(() => testDb.close());

/** A profile with these GitHub rights (null: no GitHub part). */
async function profileWith(ownerUserId: string, rights: Record<string, unknown> | null): Promise<string> {
  const id = newId();
  const stored = rights === null ? null : JSON.stringify(rights);
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, claude_part, github_rights)
        values (${id}, ${ownerUserId}, ${id}, true, ${stored}::jsonb)`,
  );
  return id;
}

const rightsOf = async (id: string) =>
  (
    await queryRows<{ github_rights: Record<string, unknown> | null }>(
      handle,
      sql`select github_rights from access_profiles where id = ${id}`,
    )
  )[0]?.github_rights;

describe(`0041_github_reviews on ${testDbKind()}: existing GitHub parts review nothing`, () => {
  it('adds reviews off to every stored GitHub part, keeps one already set, and leaves profiles without one', async () => {
    const ihor = (await insertUser(handle)).id;
    const old = await profileWith(ihor, { repos: ['AiriaLLC/*'], push: true, pullRequests: true });
    const set = await profileWith(ihor, {
      repos: 'all',
      push: false,
      pullRequests: false,
      reviews: 'approve',
    });
    const none = await profileWith(ihor, null);
    await migrateToLatest(handle);
    expect(await rightsOf(old)).toEqual({
      repos: ['AiriaLLC/*'],
      push: true,
      pullRequests: true,
      reviews: 'off',
    });
    expect(await rightsOf(set)).toMatchObject({ reviews: 'approve' });
    expect(await rightsOf(none)).toBeNull();
  });
});
