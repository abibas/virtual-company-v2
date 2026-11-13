import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { createTestDb, pgError, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { insertCredentialBefore0029, insertUser } from '../fixtures/rows.ts';

/**
 * Migration `0036_slack_part` (S7.1e): the Slack sign-ins' kinds join the kind CHECK and a profile gets a Slack part's two
 * columns, empty on every profile; nothing else changes. Seeded at the migration before it.
 */

const MINE = journal.entries.findIndex((entry) => entry.tag.endsWith('_slack_part'));
const BEFORE = (journal.entries[MINE - 1] as { tag: string }).tag;

let testDb: TestDb;
let handle: RawDbHandle;
let ownerId: string;
let profileId: string;
let githubId: string;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, BEFORE);
  ownerId = (await insertUser(handle)).id;
  githubId = (await insertCredentialBefore0029(handle, ownerId, 'github_token', { login: 'ihor' })).id;
  profileId = newId();
  const rights = JSON.stringify({ repos: ['AiriaLLC/*'], push: true, pullRequests: false });
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, github_credential_id, github_rights)
        values (${profileId}, ${ownerId}, 'Work', ${githubId}, ${rights}::jsonb)`,
  );
});
afterAll(() => testDb.close());

const profileRow = async () =>
  (
    await queryRows<Record<string, unknown>>(
      handle,
      sql`select * from access_profiles where id = ${profileId}`,
    )
  )[0];

describe(`0036_slack_part on ${testDbKind()}`, () => {
  it('is the migration after 0035_profile_mode', () => {
    expect(BEFORE).toBe('0035_profile_mode');
    expect(journal.entries[MINE]?.tag).toBe('0036_slack_part');
  });

  it('refused a Slack sign-in before it, and has no Slack columns there', async () => {
    const refused = await pgError(insertCredentialBefore0029(handle, ownerId, 'slack_bot_token'));
    expect(refused).toMatchObject({ code: '23514', constraint: 'credentials_kind_check' });
    expect(await profileRow()).not.toHaveProperty('slack_rights');
  });

  it('keeps every profile as it was, with an empty Slack part, and takes both Slack kinds after it', async () => {
    await migrateToLatest(handle);
    expect(await profileRow()).toMatchObject({
      github_credential_id: githubId,
      github_rights: { repos: ['AiriaLLC/*'], push: true, pullRequests: false },
      slack_credential_id: null,
      slack_rights: null,
    });
    const bot = await insertCredentialBefore0029(handle, ownerId, 'slack_bot_token', { team: 'Airia' });
    await insertCredentialBefore0029(handle, ownerId, 'slack_user_token');
    const rights = JSON.stringify({
      read: true,
      post: false,
      channels: 'all',
      dms: 'off',
      search: false,
      react: false,
    });
    await queryRows(
      handle,
      sql`update access_profiles set slack_credential_id = ${bot.id}, slack_rights = ${rights}::jsonb
          where id = ${profileId}`,
    );
    expect(await profileRow()).toMatchObject({
      slack_credential_id: bot.id,
      slack_rights: { channels: 'all' },
    });
    const noRights = pgError(
      queryRows(handle, sql`update access_profiles set slack_rights = null where id = ${profileId}`),
    );
    expect(await noRights).toMatchObject({ code: '23514', constraint: 'access_profiles_slack_check' });
  });
});
