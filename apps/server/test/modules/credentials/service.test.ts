import { randomBytes } from 'node:crypto';
import { auditLog, credentials, credentialUses, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { seedCompany } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../src/modules/credentials/index.ts';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { ephemeralKeyring } from '../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../fixtures/companies/companies.ts';
import { type AuthWorld, addPerson, authWorld, seedApiKey } from '../../fixtures/platform/auth.ts';

/**
 * A gateway's headers through `/api/me/subscriptions` (2026-11-13): their previews, stored when sealed and made once for
 * an older gateway, and their edits; never a whole value in a response, an audit row or the log.
 */

const PATH = '/api/me/subscriptions';
const API_KEY = 'agk-NTE5abcdefghijklmnopMHx8';
const BEARER = 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature-abcd';
const TEAM = 'team-1234';
const NEW_KEY = 'agk-REPLACEDvalue-0123456789-WXYZ';
const VALUES = [API_KEY, BEARER.slice(7), TEAM, NEW_KEY, 'added-value-0001'];

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
const bodies: unknown[] = [];
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

/** A call as `user`, its body kept for the last test's check that no response holds a value. */
const as = (user: LinkedUser, requestId?: string) => {
  const send = call(w, user.token, requestId);
  return async (method: string, path: string, body?: unknown) => {
    const res = await send(method, path, body);
    bodies.push(res.body);
    return res;
  };
};

const noValue = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of VALUES) expect(text).not.toContain(secret);
};

const gateway = (headers: Record<string, string>, label = 'Airia gateway') => ({
  kind: 'gateway',
  label,
  baseUrl: 'https://gateway.test/anthropic',
  headers,
});

async function add(user: LinkedUser, body: Record<string, unknown>) {
  const res = await as(user)('POST', PATH, body);
  if (res.status !== 201) throw new Error(`POST ${PATH} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as SubscriptionView;
}

const secrets = () => credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
const headersOf = async (id: string, owner = ihor) => {
  const used = await secrets().useCredentialSecret(id, owner.userId, 'test');
  return used.ok && used.kind === 'gateway' ? used.secret.headers : undefined;
};

const usesOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(credentialUses)
    .where(eq(credentialUses.credentialId, id))
    .orderBy(asc(credentialUses.id))
    .then((rows) => rows.map((row) => row.purpose));

const auditOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'credential'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));

const listed = async (user: LinkedUser, id: string) => {
  const res = await as(user)('GET', PATH);
  return (res.body as { subscriptions: SubscriptionView[] }).subscriptions.find((s) => s.id === id);
};

describe('header previews', () => {
  it('shows each header as its name and preview, made when it is sealed, in order', async () => {
    const view = await add(
      ihor,
      gateway({ 'x-api-key': API_KEY, Authorization: BEARER, 'x-team': TEAM, k: 'abc' }),
    );
    const previews = [
      { name: 'x-api-key', preview: 'agk-NTE5••••MHx8' },
      { name: 'Authorization', preview: 'Bearer eyJhbGci••••abcd' },
      { name: 'x-team', preview: 'te••••34' },
      { name: 'k', preview: '••••' },
    ];
    expect(view.headers).toEqual(previews);
    expect((await listed(ihor, view.id))?.headers).toEqual(previews);
    expect(await usesOf(w.t.db, view.id)).toEqual([]);
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, view.id));
    expect(row?.headerPreviews).toEqual(previews);
    noValue(view);
  });

  it('shows a gateway without headers as an empty list, and no headers for the other kinds', async () => {
    expect((await add(ihor, gateway({}, 'Memory'))).headers).toEqual([]);
    const token = await add(ihor, {
      kind: 'anthropic_api_key',
      label: 'Console',
      apiKey: 'sk-ant-api03-key-x',
    });
    expect(token.headers).toBeNull();
  });

  it('makes an older gateway’s previews on the first list only, recording one preview use', async () => {
    const view = await add(ihor, gateway({ 'x-api-key': API_KEY }, 'Older'));
    const older = { headerPreviews: null, updatedAt: new Date(view.updatedAt) };
    await rawDb(w.t.db).update(credentials).set(older).where(eq(credentials.id, view.id));
    const first = await listed(ihor, view.id);
    expect(first?.headers).toEqual([{ name: 'x-api-key', preview: 'agk-NTE5••••MHx8' }]);
    expect(first).toMatchObject({ lastUsedAt: null, updatedAt: view.updatedAt });
    expect((await listed(ihor, view.id))?.headers).toEqual(first?.headers);
    expect(await usesOf(w.t.db, view.id)).toEqual(['preview']);
    expect((await auditOf(w.t.db, view.id)).filter((r) => r.action !== 'create')).toEqual([]);
  });

  it('lists a gateway whose value does not open without previews, and tries it again later', async () => {
    const [row] = await rawDb(w.t.db)
      .insert(credentials)
      .values({
        ownerUserId: ihor.userId,
        kind: 'gateway',
        label: 'Damaged',
        accountMeta: { baseUrl: 'http://127.0.0.1:8300' },
        keyVersion: 1,
        iv: new Uint8Array(randomBytes(12)),
        authTag: new Uint8Array(randomBytes(16)),
        ciphertext: new Uint8Array(randomBytes(40)),
      })
      .returning();
    const id = row?.id ?? '';
    expect((await listed(ihor, id))?.headers).toBeNull();
    expect((await listed(ihor, id))?.headers).toBeNull();
    expect(await usesOf(w.t.db, id)).toEqual([]);
  });

  it("makes a gateway's previews again when the store replaces its secret", async () => {
    const view = await add(ihor, gateway({ 'x-api-key': API_KEY }, 'Replaced'));
    const replaced = await secrets().replaceCredentialSecret(
      view.id,
      ihor.userId,
      { headers: { 'x-team': TEAM } },
      'test',
    );
    expect(replaced).toMatchObject({
      ok: true,
      credential: { headers: [{ name: 'x-team', preview: 'te••••34' }] },
    });
  });
});

describe('editing headers (PATCH)', () => {
  it('keeps, renames, replaces, adds and removes, sealed again and audited by names only', async () => {
    const view = await add(
      ihor,
      gateway({ 'x-api-key': API_KEY, Authorization: BEARER, 'x-team': TEAM, old: 'gone' }),
    );
    const res = await as(ihor, 'req-headers')('PATCH', `${PATH}/${view.id}`, {
      headers: [
        { name: 'Authorization' },
        { name: 'x-org', from: 'x-team' },
        { name: 'x-api-key', value: NEW_KEY },
        { name: 'x-added', value: 'added-value-0001' },
      ],
    });
    expect(res).toMatchObject({ status: 200, body: { id: view.id, label: 'Airia gateway' } });
    expect((res.body as SubscriptionView).headers).toEqual([
      { name: 'Authorization', preview: 'Bearer eyJhbGci••••abcd' },
      { name: 'x-org', preview: 'te••••34' },
      { name: 'x-api-key', preview: 'agk-REPL••••WXYZ' },
      { name: 'x-added', preview: 'added-va••••0001' },
    ]);
    expect(await headersOf(view.id)).toEqual({
      Authorization: BEARER,
      'x-org': TEAM,
      'x-api-key': NEW_KEY,
      'x-added': 'added-value-0001',
    });
    const rows = (await auditOf(w.t.db, view.id)).filter((r) => r.action !== 'create');
    expect(rows.map((r) => [r.action, r.field, r.oldValue, r.newValue, r.requestId])).toEqual([
      ['update', 'header', 'x-team', 'x-org', 'req-headers'],
      ['update', 'header_value', 'x-api-key', 'x-api-key', 'req-headers'],
      ['update', 'header', null, 'x-added', 'req-headers'],
      ['update', 'header', 'old', null, 'req-headers'],
      [
        'replace_secret',
        'secret',
        { keyVersion: 1 },
        { keyVersion: 1, purpose: 'edit_headers' },
        'req-headers',
      ],
    ]);
    noValue(rows);
    expect(await usesOf(w.t.db, view.id)).toEqual(['edit_headers', 'test']);
  });

  it('changes the address and the headers together, and records nothing for the same headers', async () => {
    const view = await add(ihor, gateway({ 'x-api-key': API_KEY }, 'Both'));
    const path = `${PATH}/${view.id}`;
    const both = await as(ihor)('PATCH', path, {
      baseUrl: 'http://127.0.0.1:8300',
      headers: [{ name: 'x-key', from: 'x-api-key' }],
    });
    expect(both.body).toMatchObject({
      accountMeta: { baseUrl: 'http://127.0.0.1:8300' },
      headers: [{ name: 'x-key', preview: 'agk-NTE5••••MHx8' }],
    });
    const before = await auditOf(w.t.db, view.id);
    expect(before.filter((r) => r.action === 'update').map((r) => r.field)).toEqual([
      'accountMeta',
      'header',
    ]);
    const same = await as(ihor)('PATCH', path, { headers: [{ name: 'x-key', value: API_KEY }] });
    expect(same).toMatchObject({ status: 200, body: { headers: [{ name: 'x-key' }] } });
    expect(await auditOf(w.t.db, view.id)).toHaveLength(before.length);
    const none = await as(ihor)('PATCH', path, { headers: [] });
    expect((none.body as SubscriptionView).headers).toEqual([]);
    expect(await headersOf(view.id)).toEqual({});
  });

  it('refuses an edit it cannot make (422) or that does not fit (400), changing nothing', async () => {
    const view = await add(ihor, gateway({ 'x-api-key': API_KEY }, 'Refusals'));
    const path = `${PATH}/${view.id}`;
    for (const [headers, code] of [
      [[{ name: 'x-api-key', from: 'nope' }], 'header_not_found'],
      [[{ name: 'x-new' }], 'header_value_required'],
    ] as const) {
      expect(await as(ihor)('PATCH', path, { headers })).toMatchObject({
        status: 422,
        body: { error: { code } },
      });
    }
    for (const headers of [
      [
        { name: 'x-a', value: '1' },
        { name: 'X-A', value: '2' },
      ],
      Array.from({ length: 21 }, (_, i) => ({ name: `x-${i}`, value: 'v' })),
      [{ name: 'x key', value: 'v' }],
      [{ name: 'x-a', value: 'one\ntwo' }],
      [{ name: 'x-a', value: '' }],
      [{ name: 'x-a', value: 'v', extra: true }],
    ]) {
      expect(await as(ihor)('PATCH', path, { headers })).toMatchObject({ status: 400 });
    }
    expect(await headersOf(view.id)).toEqual({ 'x-api-key': API_KEY });
    expect((await auditOf(w.t.db, view.id)).filter((r) => r.action !== 'create')).toEqual([]);
  });

  it('refuses headers for another kind (422), another person’s gateway (404) and an API key (403)', async () => {
    const token = await add(ihor, { kind: 'anthropic_api_key', label: 'Key', apiKey: 'sk-ant-api03-key-y' });
    const headers = [{ name: 'x-a', value: 'v' }];
    expect(await as(ihor)('PATCH', `${PATH}/${token.id}`, { headers })).toMatchObject({
      status: 422,
      body: { error: { code: 'not_a_gateway' } },
    });
    const theirs = await add(other, gateway({ 'x-api-key': API_KEY }, 'Theirs'));
    expect(await as(ihor)('PATCH', `${PATH}/${theirs.id}`, { headers })).toMatchObject({
      status: 404,
      body: { error: { code: 'credential_not_found' } },
    });
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const own = (await call(w, `fake:${person.subject}`)('POST', PATH, gateway({ 'x-api-key': API_KEY })))
      .body as SubscriptionView;
    expect(await call(w, key)('PATCH', `${PATH}/${own.id}`, { headers })).toMatchObject({
      status: 403,
      body: { error: { code: 'session_required' } },
    });
    expect(await headersOf(theirs.id, other)).toEqual({ 'x-api-key': API_KEY });
  });
});

describe('never a value', () => {
  it('in any response of these tests, nor in the log', () => {
    expect(bodies.length).toBeGreaterThan(20);
    noValue(bodies);
    noValue(w.t.logs);
  });
});
