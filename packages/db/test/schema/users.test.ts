import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { userIdentities } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertUser, MISSING_ID, migratedTestDb, unique } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
});
afterAll(() => testDb.close());

describe('user_identities', () => {
  it('links (issuer, subject) to one user; the same subject at another issuer is another identity', async () => {
    const user = await insertUser(handle);
    const subject = unique('user');
    const [identity] = await handle.db
      .insert(userIdentities)
      .values({ userId: user.id, provider: 'clerk', issuer: 'https://clerk.test', subject })
      .returning();
    expect(identity).toMatchObject({
      userId: user.id,
      provider: 'clerk',
      issuer: 'https://clerk.test',
      subject,
    });
    const again = handle.db.insert(userIdentities).values({
      userId: (await insertUser(handle)).id,
      provider: 'clerk',
      issuer: 'https://clerk.test',
      subject,
    });
    expect(await pgError(again)).toMatchObject({
      code: '23505',
      constraint: 'user_identities_issuer_subject_unique',
    });
    await handle.db
      .insert(userIdentities)
      .values({ userId: user.id, provider: 'oidc', issuer: 'https://idp.test', subject });
  });

  it('refuses an unknown user', async () => {
    const query = handle.db
      .insert(userIdentities)
      .values({ userId: MISSING_ID, provider: 'clerk', issuer: 'https://clerk.test', subject: unique('s') });
    expect(await pgError(query)).toMatchObject({
      code: '23503',
      constraint: 'user_identities_user_id_users_id_fk',
    });
  });
});
