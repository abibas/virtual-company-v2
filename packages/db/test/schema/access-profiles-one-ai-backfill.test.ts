import { newId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { accessProfiles } from '../../src/schema/index.ts';
import { createTestDb, pgError, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertUser } from '../fixtures/rows.ts';

/**
 * The guard of migration `0033_one_ai_part` (the `-- custom:` part of `migrations/0033_one_ai_part.sql`): a profile has
 * a Claude part or an OpenAI part, not both. A profile with both makes the migration refuse, naming it and changing
 * nothing; once it has one, the migration adds the CHECK. The rows are seeded at `0032_generic_profiles`.
 */

const BEFORE_ONE_AI_PART = '0032_generic_profiles';

/** The migration's own refusal: the message and hint of the database error behind the rejected migration. */
async function refusal(handle: RawDbHandle): Promise<string> {
  try {
    await migrateToLatest(handle);
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as { message?: string; hint?: string };
    return `${cause.message ?? ''} ${cause.hint ?? ''}`;
  }
  throw new Error('expected the migration to refuse');
}

describe(`0033_one_ai_part on ${testDbKind()}: one AI part per profile`, () => {
  let testDb: TestDb;
  let handle: RawDbHandle;
  beforeAll(async () => {
    testDb = await createTestDb();
    handle = testDb.handle;
    await migrateUpTo(handle, BEFORE_ONE_AI_PART);
  });
  afterAll(() => testDb.close());

  const profileAt0032 = async (
    ownerUserId: string,
    name: string,
    parts: { claude: boolean; openai: boolean },
  ) => {
    const id = newId();
    await queryRows(
      handle,
      sql`insert into access_profiles (id, owner_user_id, name, claude_part, openai_part)
          values (${id}, ${ownerUserId}, ${name}, ${parts.claude}, ${parts.openai})`,
    );
    return id;
  };

  it('refuses a profile with both, naming it and changing nothing, then migrates once it has one', async () => {
    const ihor = (await insertUser(handle)).id;
    await profileAt0032(ihor, 'Claude only', { claude: true, openai: false });
    await profileAt0032(ihor, 'Tools only', { claude: false, openai: false });
    const both = await profileAt0032(ihor, 'Both', { claude: true, openai: true });

    expect(await refusal(handle)).toMatch(
      /the profile "Both" .* has both a Claude part and an OpenAI part.*remove one of its two AI parts/,
    );
    expect((await migrationStatus(handle)).last).toBe(BEFORE_ONE_AI_PART);

    await queryRows(handle, sql`update access_profiles set openai_part = false where id = ${both}`);
    await migrateToLatest(handle);
    expect((await migrationStatus(handle)).current).toBe(true);
    const kept = await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, both));
    expect(kept).toMatchObject([{ claudePart: true, openaiPart: false }]);
    const again = handle.db
      .update(accessProfiles)
      .set({ openaiPart: true })
      .where(eq(accessProfiles.id, both));
    expect(await pgError(again)).toMatchObject({ constraint: 'access_profiles_one_ai_part_check' });
  });
});
