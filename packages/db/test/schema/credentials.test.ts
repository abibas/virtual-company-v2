import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { credentials, credentialUses, type NewCredential } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertUser, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let ownerId: string;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  ownerId = (await insertUser(handle)).id;
});
afterAll(() => testDb.close());

/** A sealed row's columns, with random bytes of the right sizes standing in for a real seal. */
const sealed = (values: Partial<NewCredential> = {}): NewCredential => ({
  ownerUserId: ownerId,
  kind: 'claude_setup_token',
  label: 'Max at home',
  keyVersion: 1,
  iv: new Uint8Array(randomBytes(12)),
  authTag: new Uint8Array(randomBytes(16)),
  ciphertext: new Uint8Array(randomBytes(40)),
  ...values,
});

const insert = (values: Partial<NewCredential> = {}) =>
  handle.db.insert(credentials).values(sealed(values)).returning();

describe('credentials', () => {
  it('stores a sealed secret with its metadata; active, with no account and no use, by default', async () => {
    const values = sealed();
    const [row] = await handle.db.insert(credentials).values(values).returning();
    expect(row).toMatchObject({
      ownerUserId: ownerId,
      kind: 'claude_setup_token',
      label: 'Max at home',
      accountEmail: null,
      accountMeta: {},
      status: 'active',
      keyVersion: 1,
      lastUsedAt: null,
    });
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Uint8Array(row?.ciphertext ?? [])).toEqual(values.ciphertext);
    expect(new Uint8Array(row?.iv ?? [])).toEqual(values.iv);
    expect(new Uint8Array(row?.authTag ?? [])).toEqual(values.authTag);
  });

  it('takes every kind and status, account details and a label of 1 to 80 characters', async () => {
    for (const kind of [
      'claude_oauth',
      'codex_oauth',
      'anthropic_api_key',
      'openai_api_key',
      'gateway',
    ] as const) {
      await insert({ kind });
    }
    for (const status of ['needs_sign_in', 'revoked'] as const) await insert({ status });
    const [row] = await insert({
      label: 'x'.repeat(80),
      accountEmail: 'ihor@example.com',
      accountMeta: { plan: 'max', scopes: ['user:inference'] },
    });
    expect(row).toMatchObject({ accountEmail: 'ihor@example.com', accountMeta: { plan: 'max' } });
    expect((await insert({ label: 'y' }))[0]?.label).toBe('y');
  });

  it.each([
    ['an unknown kind', { kind: 'password' as never }, 'credentials_kind_check'],
    ['an unknown status', { status: 'expired' as never }, 'credentials_status_check'],
    ['an empty label', { label: '' }, 'credentials_label_check'],
    ['a label over 80 characters', { label: 'x'.repeat(81) }, 'credentials_label_check'],
    ['key version 0', { keyVersion: 0 }, 'credentials_key_version_check'],
    ['an iv that is not 12 bytes', { iv: new Uint8Array(11) }, 'credentials_iv_check'],
    ['a tag that is not 16 bytes', { authTag: new Uint8Array(15) }, 'credentials_auth_tag_check'],
    [
      'account details that are not an object',
      { accountMeta: ['x'] as never },
      'credentials_account_meta_check',
    ],
  ])('refuses %s', async (_, values, constraint) => {
    expect(await pgError(insert(values))).toMatchObject({ code: '23514', constraint });
  });

  it('refuses an owner who is not a user', async () => {
    expect(await pgError(insert({ ownerUserId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'credentials_owner_user_id_users_id_fk',
    });
  });

  it('is a personal table: an owner, no company', () => {
    for (const table of [credentials, credentialUses] as PgTable[]) {
      const config = getTableConfig(table);
      expect(config.columns.some((c) => c.name === 'company_id')).toBe(false);
      expect(config.columns.find((c) => c.name === 'owner_user_id')?.notNull).toBe(true);
      const refs = config.foreignKeys.map((fk) => fk.reference());
      expect(refs.map((r) => [r.columns.map((c) => c.name), getTableConfig(r.foreignTable).name])).toEqual([
        [['owner_user_id'], 'users'],
      ]);
    }
  });
});

describe('credential_uses', () => {
  it('records a use with its purpose and time, and keeps it after the credential is removed', async () => {
    const [credential] = await insert();
    const credentialId = credential?.id as string;
    const at = new Date('2026-11-05T09:00:00.000Z');
    await handle.db
      .insert(credentialUses)
      .values({ credentialId, ownerUserId: ownerId, purpose: 'usage_check', at });
    await handle.db.delete(credentials).where(eq(credentials.id, credentialId));
    const uses = await handle.db
      .select()
      .from(credentialUses)
      .where(eq(credentialUses.credentialId, credentialId));
    expect(uses).toEqual([
      { id: expect.any(Number), credentialId, ownerUserId: ownerId, purpose: 'usage_check', at },
    ]);
  });

  it.each([
    ['an empty purpose', ''],
    ['a purpose over 80 characters', 'p'.repeat(81)],
  ])('refuses %s', async (_, purpose) => {
    const query = handle.db
      .insert(credentialUses)
      .values({ credentialId: MISSING_ID, ownerUserId: ownerId, purpose });
    expect(await pgError(query)).toMatchObject({
      code: '23514',
      constraint: 'credential_uses_purpose_check',
    });
  });

  it('refuses an owner who is not a user', async () => {
    const query = handle.db
      .insert(credentialUses)
      .values({ credentialId: MISSING_ID, ownerUserId: MISSING_ID, purpose: 'run' });
    expect(await pgError(query)).toMatchObject({
      code: '23503',
      constraint: 'credential_uses_owner_user_id_users_id_fk',
    });
  });
});
