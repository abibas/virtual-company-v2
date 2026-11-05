import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { users } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { unique } from '../fixtures/rows.ts';

/**
 * The data step of migration `0006_user_profiles` (the `-- custom:` part of `migrations/0006_user_profiles.sql`):
 * `users.display_name` may be null now, and the stand-ins stored for a person without a name (the email's part before
 * the @, or a blank name) are cleared, so the web asks them for their name. The rows are seeded at `0005_org`, when
 * the column was still `not null`.
 */

let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0005_org');
});
afterAll(() => testDb.close());

describe(`0006_user_profiles on ${testDbKind()}: display names that were only stand-ins cleared`, () => {
  const names = new Map<string, string | null>();
  const seed: Record<string, readonly [email: string, displayName: string]> = {};

  beforeAll(async () => {
    const local = unique('ann');
    Object.assign(seed, {
      emailPart: [`${local}@x.test`, local],
      blank: [`${unique('blank')}@x.test`, ''],
      spaces: [`${unique('spaces')}@x.test`, '   '],
      named: [`${unique('ihor')}@x.test`, 'Ihor Herasko'],
      otherCase: [`${local}@y.test`, local.toUpperCase()],
      withImage: [`${unique('pic')}@x.test`, 'Pic Person'],
    });
    for (const [label, [primaryEmail, displayName]] of Object.entries(seed)) {
      const imageUrl = label === 'withImage' ? 'https://img.test/pic.png' : null;
      const [row] = await handle.db.insert(users).values({ primaryEmail, displayName, imageUrl }).returning();
      names.set(label, row?.id ?? '');
    }
    await migrateToLatest(handle);
  });

  const rowOf = async (label: string) => {
    const rows = await handle.db.select().from(users);
    return rows.find((row) => row.id === names.get(label));
  };

  it('applies the migration', async () => {
    expect(await migrationStatus(handle)).toMatchObject({ last: journal.entries.at(-1)?.tag, current: true });
  });

  it("clears a display name that is the email's part before the @, or blank", async () => {
    for (const label of ['emailPart', 'blank', 'spaces']) {
      expect((await rowOf(label))?.displayName, label).toBeNull();
    }
  });

  it('keeps a real name, a name that only looks like the email in another case, and the photo', async () => {
    expect(await rowOf('named')).toMatchObject({ displayName: 'Ihor Herasko', imageUrl: null });
    expect((await rowOf('otherCase'))?.displayName).toBe(seed.otherCase?.[1]);
    expect(await rowOf('withImage')).toMatchObject({
      displayName: 'Pic Person',
      imageUrl: 'https://img.test/pic.png',
    });
  });

  it('takes a person without a name from now on', async () => {
    const [row] = await handle.db
      .insert(users)
      .values({ primaryEmail: `${unique('new')}@x.test` })
      .returning();
    expect(row).toMatchObject({ displayName: null, imageUrl: null });
  });
});
