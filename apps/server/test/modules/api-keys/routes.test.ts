import { createHash } from 'node:crypto';
import { principals, tenant } from '@mwc/db';
import { API_KEY_PATTERN } from '@mwc/shared/api-keys';
import { getJson, TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ApiKeyView,
  type CreatedApiKeyView,
  keyAudit,
  keyRows,
  keysPath,
  makeKey,
} from '../../fixtures/api-keys.ts';
import { call } from '../../fixtures/companies/companies.ts';
import { addMember, as, membersCompany } from '../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, seedApiKey } from '../../fixtures/platform/auth.ts';

const DAY = 86_400_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterEach(() => w.clock.set(TEST_NOW));
afterAll(() => w.t.close());

/** Requests made with an API key instead of a session. */
const withKey = (key: string) => call(w, key);
const listed = (body: unknown) => (body as { apiKeys: ApiKeyView[] }).apiKeys;

describe('POST /api/companies/:companyId/api-keys', () => {
  it('makes a personal key for the caller, shows its secret once and stores only its SHA-256', async () => {
    const company = await membersCompany(w);
    const member = await addMember(w, company, 'member');
    const res = await as(w, member, 'req-key-1')('POST', keysPath(company), { name: '  laptop  ' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const key = res.body as CreatedApiKeyView;
    expect(key.secret).toMatch(API_KEY_PATTERN);
    expect(key.secret.startsWith('mwc_pk_')).toBe(true);
    expect(key).toEqual({
      id: key.id,
      name: 'laptop',
      kind: 'personal',
      prefix: key.secret.slice(0, 11),
      scopes: [],
      status: 'active',
      createdAt: key.createdAt,
      expiresAt: new Date(Date.parse(TEST_NOW) + 90 * DAY).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      secret: key.secret,
    });
    const [row] = await keyRows(w.t.db, company.companyId);
    expect(row).toMatchObject({
      id: key.id,
      principalId: member.principalId,
      kind: 'personal',
      prefix: key.prefix,
      secretHash: sha256(key.secret),
      scopes: [],
      machineId: null,
    });
    // Nothing stored holds the secret itself.
    expect(JSON.stringify(row)).not.toContain(key.secret.slice(11));
    expect(await keyAudit(w.t.db, key.id)).toEqual(
      ['expiresAt', 'kind', 'name', 'prefix', 'principalId', 'scopes'].map((field) => ({
        companyId: company.companyId,
        actorKind: 'user',
        actorPrincipalId: member.principalId,
        requestId: 'req-key-1',
        entityType: 'api_key',
        entityId: key.id,
        action: 'create',
        field,
        oldValue: null,
        newValue: {
          expiresAt: key.expiresAt,
          kind: 'personal',
          name: 'laptop',
          prefix: key.prefix,
          principalId: member.principalId,
          scopes: [],
        }[field],
      })),
    );
  });

  it('gives a key that acts as its owner in its own company only: /api/me and company routes', async () => {
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const other = await membersCompany(w);
    const elsewhere = await addMember(w, other, 'admin');
    expect(elsewhere.userId).not.toBe(viewer.userId);
    const { secret } = await makeKey(w, company, viewer);
    const me = await withKey(secret)('GET', '/api/me');
    expect(me).toMatchObject({
      status: 200,
      body: {
        user: { id: viewer.userId },
        memberships: [{ companyId: company.companyId, role: 'viewer', status: 'active' }],
        session: { via: 'api_key', pending: false },
      },
    });
    expect((me.body as { memberships: unknown[] }).memberships).toHaveLength(1);
    expect((await withKey(secret)('GET', company.members)).status).toBe(200);
    expect(await withKey(secret)('GET', `/api/companies/${company.companyId}`)).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    expect(await withKey(secret)('GET', other.members)).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });

  it('lets every role make keys, each a new one', async () => {
    const company = await membersCompany(w);
    const secrets = new Set<string>();
    for (const role of ['admin', 'member', 'viewer'] as const) {
      secrets.add((await makeKey(w, company, await addMember(w, company, role))).secret);
    }
    secrets.add((await makeKey(w, company, company.owner)).secret);
    secrets.add((await makeKey(w, company, company.owner)).secret);
    expect(secrets.size).toBe(5);
  });

  it('expires after 1 to 365 days, 90 by default, and refuses anything else', async () => {
    const company = await membersCompany(w);
    const now = Date.parse(TEST_NOW);
    for (const days of [1, 30, 365]) {
      const key = await makeKey(w, company, company.owner, { expiresInDays: days });
      expect(key.expiresAt).toBe(new Date(now + days * DAY).toISOString());
    }
    for (const body of [
      { name: 'x', expiresInDays: 0 },
      { name: 'x', expiresInDays: 366 },
      { name: 'x', expiresInDays: -5 },
      { name: 'x', expiresInDays: 1.5 },
      { name: 'x', expiresInDays: '30' },
      { name: 'x', expiresInDays: null },
      { name: '' },
      { name: '   ' },
      { name: 'n'.repeat(101) },
      {},
    ]) {
      expect(await as(w, company.owner)('POST', keysPath(company), body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(await keyRows(w.t.db, company.companyId)).toHaveLength(3);
  });

  it('is refused to an API key caller (403): keys never mint keys', async () => {
    const company = await membersCompany(w);
    const { secret } = await makeKey(w, company, company.owner);
    expect(await withKey(secret)('POST', keysPath(company), { name: 'from a key' })).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden', message: expect.stringContaining('not with an API key') } },
    });
    expect(await keyRows(w.t.db, company.companyId)).toHaveLength(1);
  });

  it('is a 401 without a credential and a 404 for an outsider or a removed member', async () => {
    const company = await membersCompany(w);
    const removed = await addMember(w, company, 'admin', 'removed');
    const outsider = (await membersCompany(w)).owner;
    expect(await call(w, undefined)('POST', keysPath(company), { name: 'x' })).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    for (const caller of [removed, outsider]) {
      expect(await as(w, caller)('POST', keysPath(company), { name: 'x' })).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found' } },
      });
    }
    expect(await keyRows(w.t.db, company.companyId)).toHaveLength(0);
  });
});

describe('GET /api/companies/:companyId/api-keys', () => {
  it("lists the caller's own keys newest first, with their status as of now", async () => {
    const company = await membersCompany(w);
    const member = await addMember(w, company, 'member');
    const first = await makeKey(w, company, member, { name: 'first', expiresInDays: 1 });
    const second = await makeKey(w, company, member, { name: 'second' });
    await makeKey(w, company, company.owner, { name: "the owner's" });
    await as(w, member)('DELETE', keysPath(company, second.id));
    w.clock.advance(2 * DAY);
    const res = await as(w, member)('GET', keysPath(company));
    expect(res.status).toBe(200);
    const keys = listed(res.body);
    expect(keys.map((k) => [k.name, k.status])).toEqual([
      ['second', 'revoked'],
      ['first', 'expired'],
    ]);
    expect(keys[1]).toEqual({ ...first, secret: undefined, status: 'expired' });
    expect(keys.every((k) => k.owner === undefined)).toBe(true);
    expect((await as(w, member)('GET', `${keysPath(company)}?all=0`)).body).toEqual(res.body);
  });

  it('shows when a key was last used', async () => {
    const company = await membersCompany(w);
    const { id, secret } = await makeKey(w, company, company.owner);
    await withKey(secret)('GET', company.members);
    const [key] = listed((await withKey(secret)('GET', keysPath(company))).body);
    expect(key).toMatchObject({ id, lastUsedAt: TEST_NOW });
  });

  it('lists every personal key in the company with its owner for admins and owners (?all=1)', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const member = await addMember(w, company, 'member');
    const mine = await makeKey(w, company, admin);
    const theirs = await makeKey(w, company, member);
    const runner = await seedApiKey(w.t.db, { ...company, principalId: member.principalId, kind: 'runner' });
    const other = await membersCompany(w);
    await makeKey(w, other, other.owner);
    for (const query of ['?all=1', '?all=true']) {
      for (const caller of [admin, company.owner]) {
        const res = await as(w, caller)('GET', `${keysPath(company)}${query}`);
        expect(res.status).toBe(200);
        const keys = listed(res.body);
        expect(keys.map((k) => k.id)).toEqual([theirs.id, mine.id]);
        expect(keys.map((k) => k.id)).not.toContain(runner.id);
        expect(keys[0]?.owner).toEqual({
          principalId: member.principalId,
          userId: member.userId,
          displayName: member.subject,
          email: `${member.subject}@people.test`,
        });
        expect(keys[1]?.owner).toMatchObject({ principalId: admin.principalId, userId: admin.userId });
      }
    }
  });

  it('names no owner for a key whose principal has no membership', async () => {
    const company = await membersCompany(w);
    const scoped = await tenant(w.t.db, company.companyId);
    const [agent] = await scoped.insert(principals, { kind: 'agent' }).returning();
    const orphan = await seedApiKey(w.t.db, { ...company, principalId: (agent as { id: string }).id });
    const keys = listed((await as(w, company.owner)('GET', `${keysPath(company)}?all=1`)).body);
    expect(keys.find((k) => k.id === orphan.id)?.owner).toEqual({
      principalId: (agent as { id: string }).id,
      userId: null,
      displayName: null,
      email: '',
    });
  });

  it('refuses ?all=1 below admin (403), a bad value (400), no credential (401) and outsiders (404)', async () => {
    const company = await membersCompany(w);
    expect(await as(w, company.owner)('GET', `${keysPath(company)}?all=1`)).toMatchObject({
      status: 200,
      body: { apiKeys: [] },
    });
    for (const role of ['member', 'viewer'] as const) {
      expect(
        await as(w, await addMember(w, company, role))('GET', `${keysPath(company)}?all=1`),
      ).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect((await as(w, company.owner)('GET', `${keysPath(company)}?all=yes`)).status).toBe(400);
    expect((await call(w, undefined)('GET', keysPath(company))).status).toBe(401);
    expect((await as(w, (await membersCompany(w)).owner)('GET', keysPath(company))).status).toBe(404);
  });
});

describe('DELETE /api/companies/:companyId/api-keys/:keyId', () => {
  it('revokes my own key with an audit row; the key is refused from then on; again is a no-op', async () => {
    const company = await membersCompany(w);
    const viewer = await addMember(w, company, 'viewer');
    const key = await makeKey(w, company, viewer);
    expect((await withKey(key.secret)('GET', '/api/me')).status).toBe(200);
    const res = await as(w, viewer, 'req-revoke-1')('DELETE', keysPath(company, key.id));
    expect(res).toMatchObject({ status: 200, body: { id: key.id, status: 'revoked', revokedAt: TEST_NOW } });
    expect(res.body).not.toHaveProperty('secret');
    expect(await withKey(key.secret)('GET', '/api/me')).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'The API key was revoked' } },
    });
    const audit = await keyAudit(w.t.db, key.id);
    expect(audit.at(-1)).toEqual({
      companyId: company.companyId,
      actorKind: 'user',
      actorPrincipalId: viewer.principalId,
      requestId: 'req-revoke-1',
      entityType: 'api_key',
      entityId: key.id,
      action: 'revoke',
      field: 'revokedAt',
      oldValue: null,
      newValue: TEST_NOW,
    });
    w.clock.advance(DAY);
    const again = await as(w, viewer)('DELETE', keysPath(company, key.id));
    expect(again).toMatchObject({ status: 200, body: { status: 'revoked', revokedAt: TEST_NOW } });
    expect(await keyAudit(w.t.db, key.id)).toHaveLength(audit.length);
  });

  it("lets a key revoke itself, and admins and owners revoke anyone's", async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const member = await addMember(w, company, 'member');
    const self = await makeKey(w, company, member);
    expect((await withKey(self.secret)('DELETE', keysPath(company, self.id))).status).toBe(200);
    const byAdmin = await makeKey(w, company, member);
    const ownersKey = await makeKey(w, company, company.owner);
    expect((await as(w, admin, 'req-admin')('DELETE', keysPath(company, byAdmin.id))).status).toBe(200);
    expect((await as(w, admin)('DELETE', keysPath(company, ownersKey.id))).status).toBe(200);
    const adminsKey = await makeKey(w, company, admin);
    expect((await as(w, company.owner)('DELETE', keysPath(company, adminsKey.id))).status).toBe(200);
    expect((await keyAudit(w.t.db, byAdmin.id)).at(-1)).toMatchObject({
      actorPrincipalId: admin.principalId,
      requestId: 'req-admin',
      action: 'revoke',
    });
    for (const { secret } of [self, byAdmin, ownersKey, adminsKey]) {
      expect((await withKey(secret)('GET', '/api/me')).status).toBe(401);
    }
  });

  it("refuses a member or a viewer revoking someone else's key (403), and the key keeps working", async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const key = await makeKey(w, company, admin);
    for (const role of ['member', 'viewer'] as const) {
      const someone = await addMember(w, company, role);
      expect(await as(w, someone)('DELETE', keysPath(company, key.id))).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
      const { secret } = await makeKey(w, company, someone);
      expect((await withKey(secret)('DELETE', keysPath(company, key.id))).status).toBe(403);
    }
    expect((await withKey(key.secret)('GET', '/api/me')).status).toBe(200);
    expect(await keyAudit(w.t.db, key.id)).toHaveLength(6);
  });

  it("is a 404 for another company's key, an unknown or malformed id and a runner key", async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const foreign = await makeKey(w, other, other.owner);
    const runner = await seedApiKey(w.t.db, {
      ...company,
      principalId: company.owner.principalId,
      kind: 'runner',
    });
    for (const id of [foreign.id, runner.id, '019a4f0c-0000-7000-8000-000000000000', 'not-a-uuid']) {
      expect(await as(w, company.owner)('DELETE', keysPath(company, id))).toMatchObject({
        status: 404,
        body: { error: { code: 'api_key_not_found' } },
      });
    }
    expect((await withKey(foreign.secret)('GET', '/api/me')).status).toBe(200);
    expect((await call(w, undefined)('DELETE', keysPath(company, foreign.id))).status).toBe(401);
    expect((await as(w, other.owner)('DELETE', keysPath(company, foreign.id))).status).toBe(404);
  });
});

describe('the secret and the hash', () => {
  it('appear only in the response that made the key: never in lists, revocations, audit rows or logs', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const key = await makeKey(w, company, admin);
    const hash = sha256(key.secret);
    const seen = [
      await as(w, admin)('GET', keysPath(company)),
      await as(w, admin)('GET', `${keysPath(company)}?all=1`),
      await withKey(key.secret)('GET', keysPath(company)),
      await withKey(key.secret)('GET', '/api/me'),
      await as(w, admin)('DELETE', keysPath(company, key.id)),
      await getJson(w.t.app, '/api/openapi.json'),
    ].map((res) => JSON.stringify(res.body));
    seen.push(JSON.stringify(await keyAudit(w.t.db, key.id)), JSON.stringify(w.t.logs));
    for (const text of seen) {
      expect(text).not.toContain(key.secret);
      expect(text).not.toContain(key.secret.slice(11));
      expect(text).not.toContain(hash);
    }
    expect(seen[0]).toContain(key.prefix);
  });
});
