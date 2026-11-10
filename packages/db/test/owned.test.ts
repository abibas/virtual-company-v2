import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../src/handle.ts';
import { type OwnedDb, owned, ownedIn, ownersOf } from '../src/owned.ts';
import {
  accessProfiles,
  agents,
  auditLog,
  credentials,
  credentialUses,
  principals,
} from '../src/schema/index.ts';
import { CompanyNotFoundError, type TenantDb, tenant } from '../src/tenant.ts';
import type { TestDb } from '../src/testing.ts';
import { insertCompany, insertUser, MISSING_ID, migratedTestDb, unique } from './fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let ihor: OwnedDb;
let other: OwnedDb;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  ihor = owned(handle, (await insertUser(handle)).id);
  other = owned(handle, (await insertUser(handle)).id);
});
afterAll(() => testDb.close());

/** A credential's columns, with random bytes standing in for a real seal. */
const row = (label = unique('cred')) => ({
  kind: 'claude_setup_token' as const,
  label,
  keyVersion: 1,
  iv: new Uint8Array(randomBytes(12)),
  authTag: new Uint8Array(randomBytes(16)),
  ciphertext: new Uint8Array(randomBytes(24)),
});

const add = async (o: OwnedDb, label?: string) => {
  const [inserted] = await o.insert(credentials, row(label)).returning();
  return inserted as typeof credentials.$inferSelect;
};

describe('owned()', () => {
  it('opens the personal layer of a user id, and refuses anything else', () => {
    expect(ihor.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => owned(handle, 'not-a-user')).toThrow(TypeError);
    expect(() => owned(handle, '')).toThrow('owned() takes a user id');
  });

  it("stamps the owner on inserts, replacing one the caller passed, and reads only the owner's rows", async () => {
    const mine = await add(ihor);
    const stamped = { ...row(), ownerUserId: other.userId } as ReturnType<typeof row>;
    const [also] = await ihor.insert(credentials, [stamped]).returning();
    expect(mine.ownerUserId).toBe(ihor.userId);
    expect(also?.ownerUserId).toBe(ihor.userId);
    const theirs = await add(other);
    const ids = (await ihor.select(credentials).orderBy(asc(credentials.createdAt))).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, also?.id]));
    expect(ids).not.toContain(theirs.id);
    expect(await ihor.select(credentials, eq(credentials.id, theirs.id))).toEqual([]);
    expect(await other.select(credentials, eq(credentials.id, theirs.id))).toHaveLength(1);
  });

  it("updates and deletes only the owner's rows, and never moves a row to another owner", async () => {
    const theirs = await add(other, 'theirs');
    expect(
      await ihor.update(credentials, { label: 'taken' }, eq(credentials.id, theirs.id)).returning(),
    ).toEqual([]);
    expect(await ihor.delete(credentials, eq(credentials.id, theirs.id)).returning()).toEqual([]);
    const set = { label: 'renamed', ownerUserId: ihor.userId } as { label: string };
    const [renamed] = await other.update(credentials, set, eq(credentials.id, theirs.id)).returning();
    expect(renamed).toMatchObject({ label: 'renamed', ownerUserId: other.userId });
    expect(await other.delete(credentials, eq(credentials.id, theirs.id)).returning()).toHaveLength(1);
  });

  it('scopes hand-built conditions, with and without a where', async () => {
    const mine = await add(ihor);
    const all = await handle.db.select().from(credentials).where(ihor.scoped(credentials));
    expect(all.every((r) => r.ownerUserId === ihor.userId)).toBe(true);
    const one = await handle.db
      .select()
      .from(credentials)
      .where(ihor.scoped(credentials, eq(credentials.id, mine.id)));
    expect(one.map((r) => r.id)).toEqual([mine.id]);
  });

  it('writes audit rows with no company and no principal, and nothing for no change', async () => {
    const mine = await add(ihor);
    const rows = await ihor.audit({
      actorKind: 'user',
      requestId: 'req-owned-1',
      entityType: 'credential',
      entityId: mine.id,
      action: 'update',
      changes: [{ field: 'label', old: 'a', new: 'b' }],
    });
    expect(rows.map(({ id: _id, createdAt: _at, ...r }) => r)).toEqual([
      {
        companyId: null,
        actorKind: 'user',
        actorPrincipalId: null,
        requestId: 'req-owned-1',
        entityType: 'credential',
        entityId: mine.id,
        action: 'update',
        field: 'label',
        oldValue: 'a',
        newValue: 'b',
      },
    ]);
    const none = {
      actorKind: 'system',
      entityType: 'credential',
      entityId: mine.id,
      action: 'x',
      changes: [],
    } as const;
    expect(await ihor.audit(none)).toEqual([]);
    expect(await handle.db.select().from(auditLog).where(eq(auditLog.entityId, mine.id))).toHaveLength(1);
  });

  it('runs work in one transaction on the same owner, rolled back when it throws', async () => {
    const label = unique('rolled-back');
    const failure = ihor.transaction(async (tx) => {
      expect(tx.userId).toBe(ihor.userId);
      await tx.insert(credentials, row(label));
      await tx.insert(credentialUses, { credentialId: (await add(tx)).id, purpose: 'run' });
      throw new Error('stop');
    });
    await expect(failure).rejects.toThrow('stop');
    expect(await ihor.select(credentials, eq(credentials.label, label))).toEqual([]);
    const kept = await ihor.transaction(
      async (tx) => (await tx.insert(credentials, row(label)).returning()).length,
    );
    expect(kept).toBe(1);
  });
});

describe('the bridges between the personal and the tenant layer', () => {
  const addProfile = async (o: OwnedDb) => {
    const [inserted] = await o
      .insert(accessProfiles, { name: unique('profile'), provider: 'claude' })
      .returning();
    return inserted as typeof accessProfiles.$inferSelect;
  };

  it("ownedIn reads and writes a person's rows in a company's transaction, scoped to that person", async () => {
    const company = await insertCompany(handle);
    const t = await tenant(handle, company.id);
    const mine = await addProfile(ihor);
    const theirs = await addProfile(other);
    const label = unique('in-tenant');
    const failure = t.transaction(async (tx) => {
      const o = ownedIn(tx, ihor.userId);
      expect(o.userId).toBe(ihor.userId);
      expect((await o.select(accessProfiles)).map((r) => r.id)).toContain(mine.id);
      expect(await o.select(accessProfiles, eq(accessProfiles.id, theirs.id))).toEqual([]);
      await o.insert(credentials, row(label));
      throw new Error('stop');
    });
    await expect(failure).rejects.toThrow('stop');
    expect(await ihor.select(credentials, eq(credentials.label, label))).toEqual([]);
    expect(() => ownedIn(t, 'not-a-user')).toThrow('ownedIn() takes a user id');
  });

  it('ownersOf tells whose rows these are, leaving out unknown and malformed ids', async () => {
    const t = await tenant(handle, (await insertCompany(handle)).id);
    const mine = await addProfile(ihor);
    const theirs = await addProfile(other);
    const owners = await ownersOf(t, accessProfiles, [mine.id, theirs.id, mine.id, MISSING_ID, 'nope']);
    expect(owners).toEqual(
      new Map([
        [mine.id, ihor.userId],
        [theirs.id, other.userId],
      ]),
    );
    expect(await ownersOf(t, accessProfiles, ['nope'])).toEqual(new Map());
    expect(await ownersOf(t, accessProfiles, [])).toEqual(new Map());
  });

  it("o.tenant opens a company's tenant in the person's transaction, with tenant()'s refusals", async () => {
    const company = await insertCompany(handle);
    const name = unique('rolled-back');
    const failure = ihor.transaction(async (tx) => {
      const t = await tx.tenant(company.id);
      expect(t.companyId).toBe(company.id);
      await insertAgentIn(t, name);
      await addProfile(tx);
      throw new Error('stop');
    });
    await expect(failure).rejects.toThrow('stop');
    expect(await (await tenant(handle, company.id)).select(agents, eq(agents.name, name))).toEqual([]);
    await expect(ihor.tenant(MISSING_ID)).rejects.toBeInstanceOf(CompanyNotFoundError);
    const deleted = await insertCompany(handle, { status: 'deleted' });
    await expect(ihor.tenant(deleted.id)).rejects.toBeInstanceOf(CompanyNotFoundError);
  });
});

/** An agent written through a tenant (its principal first), so it rolls back with the tenant's transaction. */
async function insertAgentIn(t: TenantDb, name: string) {
  const [principal] = await t.insert(principals, { kind: 'agent' }).returning();
  const principalId = (principal as { id: string }).id;
  await t.insert(agents, { principalId, name, slug: unique('agent'), roleTitle: 'Coder', model: 'm' });
}
