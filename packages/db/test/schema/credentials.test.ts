import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  accessProfiles,
  agents,
  credentials,
  credentialUses,
  memberships,
  type NewAccessProfile,
  type NewCredential,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMember,
  insertUser,
  MISSING_ID,
  migratedTestDb,
  unique,
} from '../fixtures/rows.ts';

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

  it('is a personal table: an owner, no company (a use names the company it was for, as a plain id)', () => {
    expect(getTableConfig(credentials).columns.some((c) => c.name === 'company_id')).toBe(false);
    expect(getTableConfig(credentialUses).columns.find((c) => c.name === 'company_id')?.notNull).toBe(false);
    for (const table of [credentials, credentialUses] as PgTable[]) {
      const config = getTableConfig(table);
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
      {
        id: expect.any(Number),
        credentialId,
        ownerUserId: ownerId,
        purpose: 'usage_check',
        at,
        companyId: null,
        agentId: null,
        chatId: null,
        principalId: null,
      },
    ]);
  });

  it("records a chat's use with its company, agent, chat and who, and refuses those without a company", async () => {
    const ids = { agentId: MISSING_ID, chatId: MISSING_ID, principalId: MISSING_ID };
    const values = { credentialId: MISSING_ID, ownerUserId: ownerId, purpose: 'chat_turn' };
    const [row] = await handle.db
      .insert(credentialUses)
      .values({ ...values, ...ids, companyId: MISSING_ID })
      .returning();
    expect(row).toMatchObject({ ...ids, companyId: MISSING_ID });
    for (const field of ['agentId', 'chatId', 'principalId'] as const) {
      expect(
        await pgError(handle.db.insert(credentialUses).values({ ...values, [field]: MISSING_ID })),
      ).toMatchObject({ code: '23514', constraint: 'credential_uses_company_check' });
    }
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

const profile = async (values: Partial<NewAccessProfile> = {}) => {
  const [row] = await handle.db
    .insert(accessProfiles)
    .values({ ownerUserId: ownerId, name: unique('profile'), provider: 'claude', ...values })
    .returning();
  return row as typeof accessProfiles.$inferSelect;
};

const profileRow = async (id: string) =>
  (await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, id)))[0];

describe('access_profiles', () => {
  it('names one provider’s subscription of its owner and a gateway, both empty by default', async () => {
    const row = await profile({ name: 'Work' });
    expect(row).toMatchObject({
      ownerUserId: ownerId,
      name: 'Work',
      provider: 'claude',
      credentialId: null,
      gatewayCredentialId: null,
      model: null,
      effort: null,
    });
    const [claude] = await insert({ kind: 'claude_oauth' });
    const [openai] = await insert({ kind: 'codex_oauth' });
    const [gateway] = await insert({ kind: 'gateway' });
    const full = await profile({
      name: 'x'.repeat(80),
      credentialId: claude?.id,
      gatewayCredentialId: gateway?.id,
    });
    expect(full).toMatchObject({ credentialId: claude?.id, gatewayCredentialId: gateway?.id });
    const codex = await profile({ provider: 'openai', credentialId: openai?.id });
    expect(codex).toMatchObject({ provider: 'openai', credentialId: openai?.id, gatewayCredentialId: null });
  });

  it('holds a model id of 1 to 100 characters and any stored level; which fit is the credentials module’s rule', async () => {
    const claude = await profile({ model: 'claude-opus-5-5', effort: 'max' });
    expect(claude).toMatchObject({ model: 'claude-opus-5-5', effort: 'max' });
    const codex = await profile({ provider: 'openai', model: 'm'.repeat(100), effort: 'ultra' });
    expect(codex).toMatchObject({ provider: 'openai', effort: 'ultra' });
    expect(codex.model).toHaveLength(100);
  });

  it('keeps names unique per owner, whatever the provider; another owner may use the same one', async () => {
    const name = unique('same');
    await profile({ name });
    expect(await pgError(profile({ name, provider: 'openai' }))).toMatchObject({
      code: '23505',
      constraint: 'access_profiles_owner_user_id_name_unique',
    });
    const other = (await insertUser(handle)).id;
    expect((await profile({ name, ownerUserId: other })).name).toBe(name);
  });

  it('gives a profile of either provider a gateway; which gateway fits is the credentials module’s rule', async () => {
    const [anthropic] = await insert({ kind: 'gateway', accountMeta: { baseUrl: 'http://127.0.0.1:8300' } });
    const [openai] = await insert({
      kind: 'gateway',
      accountMeta: { baseUrl: 'http://127.0.0.1:8300/backend-api/codex', provider: 'openai' },
    });
    const codex = await profile({ provider: 'openai', gatewayCredentialId: openai?.id });
    expect(codex).toMatchObject({ provider: 'openai', gatewayCredentialId: openai?.id });
    const claude = await profile({ gatewayCredentialId: anthropic?.id });
    expect(claude).toMatchObject({ provider: 'claude', gatewayCredentialId: anthropic?.id });
  });

  it.each([
    ['an empty name', { name: '' }, '23514', 'access_profiles_name_check'],
    ['a name over 80 characters', { name: 'x'.repeat(81) }, '23514', 'access_profiles_name_check'],
    ['another provider', { provider: 'gemini' as 'claude' }, '23514', 'access_profiles_provider_check'],
    ['no provider', { provider: null as unknown as 'claude' }, '23502', undefined],
    ['an empty model', { model: '' }, '23514', 'access_profiles_model_check'],
    ['a model over 100 characters', { model: 'm'.repeat(101) }, '23514', 'access_profiles_model_check'],
    ['an unknown effort', { effort: 'turbo' as 'high' }, '23514', 'access_profiles_effort_check'],
    [
      'an owner who is not a user',
      { ownerUserId: MISSING_ID },
      '23503',
      'access_profiles_owner_user_id_users_id_fk',
    ],
    [
      'a subscription naming no credential',
      { credentialId: MISSING_ID },
      '23503',
      'access_profiles_credential_id_credentials_id_fk',
    ],
    [
      'a gateway naming no credential',
      { gatewayCredentialId: MISSING_ID },
      '23503',
      'access_profiles_gateway_credential_id_credentials_id_fk',
    ],
  ])('refuses %s', async (_, values, code, constraint) => {
    const error = await pgError(profile(values));
    expect(error).toMatchObject({ code });
    if (constraint) expect(error).toMatchObject({ constraint });
  });

  it('empties the profiles of a credential that is removed, and only those', async () => {
    const [claude] = await insert({ kind: 'claude_setup_token' });
    const [openai] = await insert({ kind: 'openai_api_key' });
    const [gateway] = await insert({ kind: 'gateway' });
    const first = await profile({ credentialId: claude?.id, gatewayCredentialId: gateway?.id });
    const second = await profile({ credentialId: claude?.id });
    const codex = await profile({ provider: 'openai', credentialId: openai?.id });
    await handle.db.delete(credentials).where(eq(credentials.id, gateway?.id as string));
    expect(await profileRow(first.id)).toMatchObject({ credentialId: claude?.id, gatewayCredentialId: null });
    await handle.db.delete(credentials).where(eq(credentials.id, claude?.id as string));
    expect(await profileRow(first.id)).toMatchObject({ credentialId: null });
    expect(await profileRow(second.id)).toMatchObject({ credentialId: null });
    expect(await profileRow(codex.id)).toMatchObject({ credentialId: openai?.id });
  });

  it('is taken off its agents and its owner’s defaults when it is removed', async () => {
    const company = await insertCompany(handle);
    const member = await insertMember(handle, company.id, { userId: ownerId });
    const given = await profile();
    const kept = await profile();
    const codex = await profile({ provider: 'openai' });
    const agent = await insertAgent(handle, company.id, { profileId: given.id });
    const other = await insertAgent(handle, company.id, { profileId: kept.id });
    await handle.db
      .update(memberships)
      .set({ defaultClaudeProfileId: given.id, defaultOpenaiProfileId: codex.id })
      .where(eq(memberships.id, member.membership.id));
    await handle.db.delete(accessProfiles).where(eq(accessProfiles.id, given.id));
    const profileOf = async (id: string) =>
      (await handle.db.select().from(agents).where(eq(agents.id, id)))[0]?.profileId;
    expect(await profileOf(agent.id)).toBeNull();
    expect(await profileOf(other.id)).toBe(kept.id);
    const membershipRow = async () =>
      (await handle.db.select().from(memberships).where(eq(memberships.id, member.membership.id)))[0];
    expect(await membershipRow()).toMatchObject({
      defaultClaudeProfileId: null,
      defaultOpenaiProfileId: codex.id,
    });
    await handle.db.delete(accessProfiles).where(eq(accessProfiles.id, codex.id));
    expect(await membershipRow()).toMatchObject({
      defaultClaudeProfileId: null,
      defaultOpenaiProfileId: null,
    });
  });

  it('refuses an agent or a default naming no profile', async () => {
    const company = await insertCompany(handle);
    expect(await pgError(insertAgent(handle, company.id, { profileId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'agents_profile_id_access_profiles_id_fk',
    });
    for (const [field, column] of [
      ['defaultClaudeProfileId', 'default_claude_profile_id'],
      ['defaultOpenaiProfileId', 'default_openai_profile_id'],
    ] as const) {
      expect(await pgError(insertMember(handle, company.id, { [field]: MISSING_ID }))).toMatchObject({
        code: '23503',
        constraint: `memberships_${column}_access_profiles_id_fk`,
      });
    }
  });

  it('is a personal table: an owner, no company, a subscription, a gateway, a model and an effort', () => {
    const config = getTableConfig(accessProfiles);
    expect(config.columns.some((c) => c.name === 'company_id')).toBe(false);
    expect(config.columns.find((c) => c.name === 'owner_user_id')?.notNull).toBe(true);
    expect(config.columns.find((c) => c.name === 'provider')?.notNull).toBe(true);
    for (const name of ['model', 'effort'])
      expect(config.columns.find((c) => c.name === name)?.notNull, name).toBe(false);
    const refs = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns.map((c) => c.name), getTableConfig(ref.foreignTable).name, fk.onDelete];
    });
    expect(refs).toEqual(
      expect.arrayContaining([
        [['owner_user_id'], 'users', 'no action'],
        [['credential_id'], 'credentials', 'set null'],
        [['gateway_credential_id'], 'credentials', 'set null'],
      ]),
    );
    expect(refs).toHaveLength(3);
  });
});
