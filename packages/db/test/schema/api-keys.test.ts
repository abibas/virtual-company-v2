import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { apiKeys, type Company, type NewApiKey, type Principal } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertMachine, insertPrincipal, migratedTestDb, unique } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let owner: Principal;

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  owner = await insertPrincipal(handle, acme.id);
});
afterAll(() => testDb.close());

function key(values: Partial<NewApiKey> = {}) {
  const secret = unique('mwc_pk_secret');
  return handle.db
    .insert(apiKeys)
    .values({
      companyId: acme.id,
      principalId: owner.id,
      kind: 'personal',
      name: 'laptop',
      prefix: secret.slice(0, 12),
      secretHash: hash(secret),
      ...values,
    })
    .returning();
}

describe('api_keys', () => {
  it('stores a personal key with no scopes, no expiry and nothing used yet', async () => {
    const [row] = await key({ expiresAt: new Date('2027-02-01T00:00:00Z') });
    expect(row).toMatchObject({
      kind: 'personal',
      scopes: [],
      machineId: null,
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: new Date('2027-02-01T00:00:00Z'),
    });
    const [scoped] = await key({ scopes: ['tasks:read', 'tasks:write'] });
    expect(scoped?.scopes).toEqual(['tasks:read', 'tasks:write']);
  });

  it('refuses a taken hash and anything but 64 lower-case hex digits', async () => {
    const secretHash = hash(unique('one'));
    await key({ secretHash });
    expect(await pgError(key({ secretHash }))).toMatchObject({
      code: '23505',
      constraint: 'api_keys_secret_hash_unique',
    });
    for (const bad of [secretHash.toUpperCase(), secretHash.slice(1), 'not-a-hash']) {
      expect(await pgError(key({ secretHash: bad }))).toMatchObject({
        code: '23514',
        constraint: 'api_keys_secret_hash_check',
      });
    }
  });

  it('binds a runner key to a machine and refuses an unknown kind', async () => {
    expect(await pgError(key({ kind: 'runner' }))).toMatchObject({
      code: '23514',
      constraint: 'api_keys_runner_machine_check',
    });
    const machine = await insertMachine(handle, acme.id);
    const [runner] = await key({ kind: 'runner', machineId: machine.id });
    expect(runner?.machineId).toBe(machine.id);
    await expect(key({ kind: 'scim' })).resolves.toHaveLength(1);
    // @ts-expect-error kind is typed as ApiKeyKind; the database refuses it as well
    expect(await pgError(key({ kind: 'service' }))).toMatchObject({
      code: '23514',
      constraint: 'api_keys_kind_check',
    });
  });

  it("refuses another company's principal or machine, and a machine that does not exist", async () => {
    const globex = await insertCompany(handle);
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await pgError(key({ principalId: theirs.id }))).toMatchObject({
      code: '23503',
      constraint: 'api_keys_principal_fk',
    });
    const theirMachine = await insertMachine(handle, globex.id);
    for (const machineId of [theirMachine.id, '0190f5f0-0000-7000-8000-00000000abcd']) {
      expect(await pgError(key({ kind: 'runner', machineId }))).toMatchObject({
        code: '23503',
        constraint: 'api_keys_machine_fk',
      });
    }
  });
});
