import { auditLog, credentials, credentialUses, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { credentialSecrets, type StoreCredentialInput } from '../../../../src/modules/credentials/index.ts';
import { ephemeralKeyring, SecretOpenError } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

const TOKEN = 'sk-ant-oat01-INTERNALsecretNEVERshown';
const ACCESS = 'sk-ant-oat01-ACCESStokenNEVERshown';

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
let store: ReturnType<typeof credentialSecrets>;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
  store = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
});
afterAll(() => w.t.close());

const setupToken = (owner = ihor): StoreCredentialInput => ({
  ownerUserId: owner.userId,
  kind: 'claude_setup_token',
  label: 'Max at home',
  secret: { token: TOKEN },
});

const row = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(credentials).where(eq(credentials.id, id)))[0];
const usesOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(credentialUses)
    .where(eq(credentialUses.credentialId, id))
    .orderBy(asc(credentialUses.id));
const auditOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'credential'), eq(auditLog.entityId, id)));

describe('storeCredential', () => {
  it('seals a Claude login with its account, keeping the fields the CLI writes, and audits it without the secret', async () => {
    const login = {
      credentials: {
        claudeAiOauth: { accessToken: ACCESS, refreshToken: 'r', expiresAt: 1, scopes: ['user:inference'] },
      },
      account: { emailAddress: 'ihor@example.com', organizationName: 'Ihor', somethingNew: { kept: true } },
    };
    const view = await store.storeCredential({
      ownerUserId: ihor.userId,
      kind: 'claude_oauth',
      label: 'Max',
      secret: login,
      accountEmail: 'ihor@example.com',
      accountMeta: { plan: 'max', organization: 'Ihor' },
      requestId: 'req-sign-in',
    });
    expect(view).toMatchObject({
      kind: 'claude_oauth',
      label: 'Max',
      accountEmail: 'ihor@example.com',
      accountMeta: { plan: 'max', organization: 'Ihor' },
      status: 'active',
    });
    const used = await store.useCredentialSecret(view.id, ihor.userId, 'usage_check');
    expect(used).toMatchObject({ ok: true, kind: 'claude_oauth', secret: login });
    const audit = await auditOf(w.t.db, view.id);
    expect(audit.map((r) => r.field).sort()).toEqual([
      'accountEmail',
      'accountMeta',
      'kind',
      'label',
      'ownerUserId',
      'status',
    ]);
    expect(audit.every((r) => r.requestId === 'req-sign-in' && r.actorKind === 'user')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(ACCESS);
  });

  it('seals an OpenAI login', async () => {
    const auth = {
      OPENAI_API_KEY: null,
      tokens: { access_token: 'a', refresh_token: 'r' },
      last_refresh: 'now',
    };
    const view = await store.storeCredential({
      ownerUserId: ihor.userId,
      kind: 'codex_oauth',
      label: 'ChatGPT Pro',
      secret: { auth },
    });
    expect(await store.useCredentialSecret(view.id, ihor.userId, 'usage_check')).toMatchObject({
      kind: 'codex_oauth',
      secret: { auth },
    });
  });

  it('refuses a name that does not fit and a secret of another shape, storing nothing', async () => {
    const before = (await rawDb(w.t.db).select().from(credentials)).length;
    await expect(store.storeCredential({ ...setupToken(), label: '  ' })).rejects.toThrow(RangeError);
    await expect(store.storeCredential({ ...setupToken(), label: 'x'.repeat(81) })).rejects.toThrow(
      RangeError,
    );
    const wrong: StoreCredentialInput = {
      ownerUserId: ihor.userId,
      kind: 'claude_setup_token',
      label: 'Wrong',
      secret: { token: 'sk-proj-not-a-setup-token' },
    };
    await expect(store.storeCredential(wrong)).rejects.toThrow(ZodError);
    expect((await rawDb(w.t.db).select().from(credentials)).length).toBe(before);
  });
});

describe('useCredentialSecret', () => {
  it('opens the secret, records the use with its purpose and time, and moves last_used_at only', async () => {
    const view = await store.storeCredential(setupToken());
    const before = await row(w.t.db, view.id);
    const used = await store.useCredentialSecret(view.id, ihor.userId, 'usage_check');
    expect(used).toEqual({
      ok: true,
      kind: 'claude_setup_token',
      secret: { token: TOKEN },
      credential: { ...view, lastUsedAt: TEST_NOW },
    });
    w.clock.advance(60_000);
    await store.useCredentialSecret(view.id, ihor.userId, 'run');
    const uses = await usesOf(w.t.db, view.id);
    expect(uses.map((u) => [u.purpose, u.at.toISOString(), u.ownerUserId])).toEqual([
      ['usage_check', TEST_NOW, ihor.userId],
      ['run', new Date(Date.parse(TEST_NOW) + 60_000).toISOString(), ihor.userId],
    ]);
    const after = await row(w.t.db, view.id);
    expect(after?.lastUsedAt?.toISOString()).toBe(new Date(Date.parse(TEST_NOW) + 60_000).toISOString());
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    w.clock.set(TEST_NOW);
  });

  it("refuses another owner's, an unknown and a malformed id, recording nothing", async () => {
    const view = await store.storeCredential(setupToken());
    expect(await store.useCredentialSecret(view.id, other.userId, 'run')).toMatchObject({
      ok: false,
      code: 'credential_not_found',
    });
    for (const id of [newId(), 'not-an-id']) {
      expect(await store.useCredentialSecret(id, ihor.userId, 'run')).toMatchObject({
        code: 'credential_not_found',
      });
    }
    expect(await usesOf(w.t.db, view.id)).toEqual([]);
  });

  it('refuses a revoked subscription, and opens one that needs signing in again', async () => {
    const view = await store.storeCredential(setupToken());
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, view.id));
    expect(await store.useCredentialSecret(view.id, ihor.userId, 'run')).toMatchObject({
      ok: false,
      code: 'credential_revoked',
    });
    await rawDb(w.t.db)
      .update(credentials)
      .set({ status: 'needs_sign_in' })
      .where(eq(credentials.id, view.id));
    expect(await store.useCredentialSecret(view.id, ihor.userId, 'refresh')).toMatchObject({ ok: true });
    expect((await usesOf(w.t.db, view.id)).map((u) => u.purpose)).toEqual(['refresh']);
  });

  it('refuses a purpose that does not fit', async () => {
    const view = await store.storeCredential(setupToken());
    await expect(store.useCredentialSecret(view.id, ihor.userId, '')).rejects.toThrow(RangeError);
    await expect(store.useCredentialSecret(view.id, ihor.userId, 'p'.repeat(81))).rejects.toThrow(RangeError);
  });
});

describe('a sealed row that was tampered with or moved', () => {
  /** The reason the use failed; nothing may be recorded for it. */
  async function openFails(id: string, owner: LinkedUser): Promise<string> {
    const error = await store.useCredentialSecret(id, owner.userId, 'run').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SecretOpenError);
    expect(String(error)).not.toContain(TOKEN);
    expect(await usesOf(w.t.db, id)).toEqual([]);
    return (error as SecretOpenError).reason;
  }

  const update = (id: string, set: Partial<typeof credentials.$inferInsert>) =>
    rawDb(w.t.db).update(credentials).set(set).where(eq(credentials.id, id));

  it('does not open a changed ciphertext, IV or tag', async () => {
    for (const column of ['ciphertext', 'iv', 'authTag'] as const) {
      const view = await store.storeCredential(setupToken());
      const bytes = new Uint8Array((await row(w.t.db, view.id))?.[column] ?? []);
      bytes[0] = (bytes[0] as number) ^ 0xff;
      await update(view.id, { [column]: bytes });
      expect(await openFails(view.id, ihor)).toBe('unreadable');
    }
  });

  it('does not open a secret copied onto another id, moved to another owner or relabelled as another kind', async () => {
    const source = await store.storeCredential(setupToken());
    const sealed = (await row(w.t.db, source.id)) as typeof credentials.$inferSelect;
    const copy = await store.storeCredential(setupToken());
    await update(copy.id, { iv: sealed.iv, authTag: sealed.authTag, ciphertext: sealed.ciphertext });
    expect(await openFails(copy.id, ihor)).toBe('unreadable');

    const moved = await store.storeCredential(setupToken());
    await update(moved.id, { ownerUserId: other.userId });
    expect(await openFails(moved.id, other)).toBe('unreadable');

    const relabelled = await store.storeCredential(setupToken());
    await update(relabelled.id, { kind: 'anthropic_api_key' });
    expect(await openFails(relabelled.id, ihor)).toBe('unreadable');
  });

  it('does not open a secret sealed under a key version this server lacks', async () => {
    const view = await store.storeCredential(setupToken());
    await update(view.id, { keyVersion: 2 });
    expect(await openFails(view.id, ihor)).toBe('unknown_key_version');
  });
});
