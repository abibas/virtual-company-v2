import { createHash } from 'node:crypto';
import { apiKeys, type DbHandle, principals, tenant } from '@mwc/db';
import { rawDb, rawHandle } from '@mwc/db/system';
import { getJson, LEVEL, seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  apiKeyKind,
  checkApiKey,
  generateApiKey,
  hashApiKey,
  LAST_USED_INTERVAL_MS,
  randomBase62,
} from '../../../src/platform/auth/api-keys.ts';
import {
  type AuthWorld,
  addPerson,
  authWorld,
  bearer,
  newApiKey,
  type Person,
  seedApiKey,
} from '../../fixtures/auth.ts';

let w: AuthWorld;
let companyId: string;
let person: Person;
beforeAll(async () => {
  w = await authWorld();
  companyId = (await seedCompany(w.t.db)).company.id;
  person = await addPerson(w.t.db, w.fake, companyId, { role: 'admin' });
});
afterAll(() => w.t.close());

const probe = (key: string, role = 'admin') =>
  getJson(w.t.app, `/api/companies/${companyId}/probe/${role}`, bearer(key));
const lastUsed = async (id: string) =>
  (await rawDb(w.t.db).select().from(apiKeys).where(eq(apiKeys.id, id)))[0]?.lastUsedAt ?? null;

describe('API key format', () => {
  it('names the kind of a well-formed key and nothing else', () => {
    expect(apiKeyKind(newApiKey('pk'))).toBe('personal');
    expect(apiKeyKind(newApiKey('rk'))).toBe('runner');
    expect(apiKeyKind(newApiKey('sc'))).toBe('scim');
    for (const bad of [
      newApiKey('zz'),
      `${newApiKey('pk')}x`,
      newApiKey('pk').slice(0, -1),
      'mwc_pk_!'.padEnd(39, '!'),
    ]) {
      expect(apiKeyKind(bad)).toBeNull();
    }
    expect(API_KEY_PATTERN.test(newApiKey())).toBe(true);
  });

  it('stores the SHA-256 of the whole key as hex', () => {
    const key = newApiKey();
    expect(hashApiKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates well-formed keys of each kind with their prefix and hash, all different', () => {
    const seen = new Set<string>();
    for (const [kind, letters] of [
      ['personal', 'pk'],
      ['runner', 'rk'],
      ['scim', 'sc'],
    ] as const) {
      for (let i = 0; i < 50; i++) {
        const { key, prefix, secretHash } = generateApiKey(kind);
        expect(apiKeyKind(key)).toBe(kind);
        expect(key.startsWith(`mwc_${letters}_`)).toBe(true);
        expect(prefix).toBe(key.slice(0, 11));
        expect(secretHash).toBe(hashApiKey(key));
        seen.add(key);
      }
    }
    expect(seen.size).toBe(150);
  });

  it('draws base62 without modulo bias: bytes of 248 and above are drawn again', () => {
    const draws = [
      [0, 61, 62, 247, 248, 255],
      [255, 124, 1],
    ];
    const random = (size: number) => {
      expect(size).toBe(5);
      return Uint8Array.from(draws.shift() ?? []);
    };
    // 0 → '0', 61 → 'z', 62 → '0' (62 % 62), 247 → 'z' (247 % 62 = 61); 248 and 255 thrown away; then 124 → '0'.
    expect(randomBase62(5, random)).toBe('0z0z0');
    expect(draws).toEqual([]);
    expect(randomBase62(32)).toMatch(/^[0-9A-Za-z]{32}$/);
  });
});

describe('API keys through authn()', () => {
  it("acts as the key's person in its company", async () => {
    const { key, id } = await seedApiKey(w.t.db, { companyId, principalId: person.principalId });
    expect(await probe(key)).toMatchObject({
      status: 200,
      body: {
        actor: {
          kind: 'user',
          via: 'api_key',
          userId: person.userId,
          principalId: person.principalId,
          companyId,
          apiKeyId: id,
        },
        membership: { role: 'admin' },
      },
    });
    expect((await probe(key, 'owner')).status).toBe(403);
  });

  it.each([
    ['an unknown key', () => newApiKey(), 'The API key is not valid'],
    ['a key with a wrong prefix', () => newApiKey('xx'), 'The API key is not valid'],
    ['a malformed key', () => 'mwc_pk_short', 'The API key is not valid'],
    ['a runner key', () => newApiKey('rk'), 'This kind of API key is not accepted here'],
    ['a SCIM key', () => newApiKey('sc'), 'This kind of API key is not accepted here'],
  ])('refuses %s with 401', async (_label, key, message) => {
    expect(await probe(key())).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated', message } },
    });
  });

  it('refuses a revoked key and an expired one (expiring now counts as expired)', async () => {
    const now = w.clock();
    const revoked = await seedApiKey(w.t.db, { companyId, principalId: person.principalId, revokedAt: now });
    const expired = await seedApiKey(w.t.db, { companyId, principalId: person.principalId, expiresAt: now });
    const later = await seedApiKey(w.t.db, {
      companyId,
      principalId: person.principalId,
      expiresAt: new Date(now.getTime() + 1000),
    });
    expect(await probe(revoked.key)).toMatchObject({
      status: 401,
      body: { error: { message: 'The API key was revoked' } },
    });
    expect(await probe(expired.key)).toMatchObject({
      status: 401,
      body: { error: { message: 'The API key has expired' } },
    });
    expect((await probe(later.key)).status).toBe(200);
  });

  it('refuses a stored runner key under the personal prefix, and a key without a person behind it', async () => {
    const runner = await seedApiKey(w.t.db, { companyId, principalId: person.principalId, kind: 'runner' });
    const disguised = `mwc_pk_${runner.key.slice(7)}`;
    await rawDb(w.t.db)
      .update(apiKeys)
      .set({ secretHash: hashApiKey(disguised) })
      .where(eq(apiKeys.id, runner.id));
    expect((await probe(disguised)).status).toBe(401);
    const scoped = await tenant(w.t.db, companyId);
    const [agent] = await scoped.insert(principals, { kind: 'agent' }).returning();
    const orphan = await seedApiKey(w.t.db, { companyId, principalId: (agent as { id: string }).id });
    expect((await probe(orphan.key)).status).toBe(401);
  });

  it('refuses the key of a deactivated person (403 user_deactivated)', async () => {
    const gone = await addPerson(w.t.db, w.fake, companyId, { deactivated: true });
    const { key } = await seedApiKey(w.t.db, { companyId, principalId: gone.principalId });
    expect(await probe(key)).toMatchObject({ status: 403, body: { error: { code: 'user_deactivated' } } });
  });
});

describe('API key last use', () => {
  it('is recorded on first use, then at most once a minute', async () => {
    const { key, id } = await seedApiKey(w.t.db, { companyId, principalId: person.principalId });
    const first = w.clock();
    await probe(key);
    expect(await lastUsed(id)).toEqual(first);
    w.clock.advance(LAST_USED_INTERVAL_MS - 1);
    await probe(key);
    expect(await lastUsed(id)).toEqual(first);
    w.clock.advance(1);
    await probe(key);
    expect(await lastUsed(id)).toEqual(w.clock());
  });

  it('never fails the request when the write fails, and logs it', async () => {
    const { key, id } = await seedApiKey(w.t.db, { companyId, principalId: person.principalId });
    const raw = rawHandle(w.t.db);
    const failingDb = new Proxy(raw.db, {
      get: (target, property, receiver) =>
        property === 'update'
          ? () => {
              throw new Error('database went away');
            }
          : Reflect.get(target, property, receiver),
    });
    const handle = { ...raw, db: failingDb } as unknown as DbHandle;
    const result = await checkApiKey(handle, key, w.clock(), w.t.logger);
    expect(result).toMatchObject({ ok: true, actor: { apiKeyId: id } });
    expect(await lastUsed(id)).toBeNull();
    const line = w.t.logs.find((l) => l.msg === 'api key: last_used_at not recorded');
    expect(line).toMatchObject({ level: LEVEL.warn, apiKeyId: id });
  });
});
