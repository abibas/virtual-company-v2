import { auditLog, credentials, credentialUses } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/auth.ts';
import { addUser, type LinkedUser } from '../../../fixtures/companies.ts';

const OLD = 'sk-ant-oat01-REPLACEoldNEVERshown';
const NEW = 'sk-ant-oat01-REPLACEnewNEVERshown';

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

const login = (accessToken: string) => ({ credentials: { claudeAiOauth: { accessToken } }, account: null });
const addLogin = () =>
  store.storeCredential({ ownerUserId: ihor.userId, kind: 'claude_oauth', label: 'Max', secret: login(OLD) });
const rowOf = async (id: string) =>
  (await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id)))[0];
const updatesOf = (id: string) =>
  rawDb(w.t.db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, id), eq(auditLog.entityType, 'credential')))
    .orderBy(asc(auditLog.id))
    .then((rows) => rows.filter((r) => r.action !== 'create'));

describe('replaceCredentialSecret', () => {
  it('seals the new secret in place of the old one and audits that it changed, never what it was', async () => {
    const view = await addLogin();
    const before = await rowOf(view.id);
    w.clock.advance(60_000);
    const replaced = await store.replaceCredentialSecret(
      view.id,
      ihor.userId,
      login(NEW),
      'usage_check',
      'req-9',
    );
    expect(replaced).toMatchObject({
      ok: true,
      credential: { id: view.id, updatedAt: w.clock().toISOString() },
    });
    const used = await store.useCredentialSecret(view.id, ihor.userId, 'check');
    expect(used).toMatchObject({ ok: true, secret: login(NEW) });
    const after = await rowOf(view.id);
    expect(Buffer.from(after?.ciphertext ?? []).equals(Buffer.from(before?.ciphertext ?? []))).toBe(false);
    expect(Buffer.from(after?.iv ?? []).equals(Buffer.from(before?.iv ?? []))).toBe(false);
    const audit = await updatesOf(view.id);
    expect(audit.map((r) => [r.actorKind, r.action, r.field, r.oldValue, r.newValue, r.requestId])).toEqual([
      [
        'system',
        'replace_secret',
        'secret',
        { keyVersion: 1 },
        { keyVersion: 1, purpose: 'usage_check' },
        'req-9',
      ],
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/REPLACE(old|new)/);
    const uses = await rawDb(w.t.db)
      .select()
      .from(credentialUses)
      .where(eq(credentialUses.credentialId, view.id));
    expect(uses.map((u) => u.purpose)).toEqual(['check']);
  });

  it("refuses another person's, an unknown and a revoked credential, changing nothing", async () => {
    const view = await addLogin();
    const before = await rowOf(view.id);
    expect(
      await store.replaceCredentialSecret(view.id, other.userId, login(NEW), 'usage_check'),
    ).toMatchObject({
      ok: false,
      code: 'credential_not_found',
    });
    expect(
      await store.replaceCredentialSecret(newId(), ihor.userId, login(NEW), 'usage_check'),
    ).toMatchObject({
      code: 'credential_not_found',
    });
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, view.id));
    expect(
      await store.replaceCredentialSecret(view.id, ihor.userId, login(NEW), 'usage_check'),
    ).toMatchObject({
      code: 'credential_revoked',
    });
    expect((await rowOf(view.id))?.ciphertext).toEqual(before?.ciphertext);
    expect(await updatesOf(view.id)).toEqual([]);
  });

  it("refuses a secret of another kind's shape and a purpose that does not fit", async () => {
    const view = await addLogin();
    await expect(
      store.replaceCredentialSecret(view.id, ihor.userId, { token: 3 } as never, 'usage_check'),
    ).rejects.toThrow(ZodError);
    await expect(store.replaceCredentialSecret(view.id, ihor.userId, login(NEW), '')).rejects.toThrow(
      RangeError,
    );
    expect(await updatesOf(view.id)).toEqual([]);
  });
});

describe('setCredentialStatus', () => {
  it('changes the status once, with its audit row, and back', async () => {
    const view = await addLogin();
    expect(await store.setCredentialStatus(view.id, ihor.userId, 'needs_sign_in', 'req-1')).toBe(true);
    expect(await store.setCredentialStatus(view.id, ihor.userId, 'needs_sign_in')).toBe(false);
    expect(await store.setCredentialStatus(view.id, ihor.userId, 'active')).toBe(true);
    expect((await rowOf(view.id))?.status).toBe('active');
    expect((await updatesOf(view.id)).map((r) => [r.actorKind, r.oldValue, r.newValue, r.requestId])).toEqual(
      [
        ['system', 'active', 'needs_sign_in', 'req-1'],
        ['system', 'needs_sign_in', 'active', null],
      ],
    );
  });

  it("leaves a revoked credential, another person's and an unknown one alone", async () => {
    const view = await addLogin();
    expect(await store.setCredentialStatus(view.id, other.userId, 'needs_sign_in')).toBe(false);
    expect(await store.setCredentialStatus(newId(), ihor.userId, 'needs_sign_in')).toBe(false);
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, view.id));
    expect(await store.setCredentialStatus(view.id, ihor.userId, 'active')).toBe(false);
    expect((await rowOf(view.id))?.status).toBe('revoked');
    expect(await updatesOf(view.id)).toEqual([]);
  });
});
