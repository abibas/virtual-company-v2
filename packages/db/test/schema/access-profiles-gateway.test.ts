import { randomBytes } from 'node:crypto';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { credentials } from '../../src/schema/index.ts';
import { createTestDb, pgError, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertUser, unique } from '../fixtures/rows.ts';

/**
 * Migration `0016_gateway_provider`: gateways get a provider (`accountMeta.provider`, `anthropic` or `openai`) and an
 * OpenAI profile may hold one, so the CHECK that kept gateways on Claude profiles (`access_profiles_gateway_check`, since
 * `0015_profile_provider`) is dropped; that a profile's gateway is of its own provider is the credentials module's rule,
 * since SQL cannot read the gateway's account details from here. No data step: older gateways read as `anthropic`.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let ownerId: string;
let gatewayId: string;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0015_profile_provider');
  ownerId = (await insertUser(handle)).id;
  const [gateway] = await handle.db
    .insert(credentials)
    .values({
      ownerUserId: ownerId,
      kind: 'gateway',
      label: unique('gateway'),
      accountMeta: { baseUrl: 'http://127.0.0.1:8300/backend-api/codex', provider: 'openai' },
      keyVersion: 1,
      iv: new Uint8Array(randomBytes(12)),
      authTag: new Uint8Array(randomBytes(16)),
      ciphertext: new Uint8Array(randomBytes(24)),
    })
    .returning();
  gatewayId = gateway?.id as string;
});
afterAll(() => testDb.close());

/** An OpenAI profile holding this gateway, written with the columns `access_profiles` had at `0015`. */
const openaiProfile = (gatewayCredentialId: string) =>
  queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, provider, gateway_credential_id)
        values (${newId()}, ${ownerId}, ${unique('profile')}, 'openai', ${gatewayCredentialId})
        returning provider, gateway_credential_id`,
  );

describe(`0016_gateway_provider on ${testDbKind()}: an OpenAI profile may hold a gateway`, () => {
  it('refuses an OpenAI profile’s gateway at 0015, and takes it once 0016 dropped the CHECK', async () => {
    expect(await pgError(openaiProfile(gatewayId))).toMatchObject({
      code: '23514',
      constraint: 'access_profiles_gateway_check',
    });
    await migrateToLatest(handle);
    const [row] = await openaiProfile(gatewayId);
    expect(row).toMatchObject({ provider: 'openai', gateway_credential_id: gatewayId });
  });
});
