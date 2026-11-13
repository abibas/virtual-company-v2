import { auditLog, credentials, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, getJson, seedCompany } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../src/modules/credentials/index.ts';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { ephemeralKeyring } from '../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../fixtures/companies/companies.ts';
import { type AuthWorld, addPerson, authWorld, seedApiKey } from '../../fixtures/platform/auth.ts';

const PATH = '/api/me/subscriptions';
const SETUP_TOKEN = 'sk-ant-oat01-SETUPtokenNEVERshownAGAIN_0123456789';
const ANTHROPIC_KEY = 'sk-ant-api03-ANTHROPICkeyNEVERshown_abcdef';
const OPENAI_KEY = 'sk-proj-OPENAIkeyNEVERshown_ghijkl';
const GATEWAY_VALUE = 'gw-HEADERvalueNEVERshown';
const SECRETS = [SETUP_TOKEN, ANTHROPIC_KEY, OPENAI_KEY, GATEWAY_VALUE];

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (user: LinkedUser, requestId?: string) => call(w, user.token, requestId);

/** Asserts a body (or rows) carry none of the pasted secrets. */
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

async function add(user: LinkedUser, body: Record<string, unknown>, requestId?: string) {
  const res = await as(user, requestId)('POST', PATH, body);
  if (res.status !== 201) throw new Error(`POST ${PATH} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as SubscriptionView;
}

const setupToken = (label = 'Max at home') => ({ kind: 'claude_setup_token', label, token: SETUP_TOKEN });
const gateway = {
  kind: 'gateway',
  label: 'Gateway 8300',
  baseUrl: 'http://localhost:8300',
  headers: { 'x-api-key': GATEWAY_VALUE },
};

const auditOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'credential'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));

describe('POST /api/me/subscriptions', () => {
  it('seals a pasted setup-token and answers 201 with metadata only', async () => {
    const res = await as(ihor, 'req-sub-1')('POST', PATH, setupToken('  Max at home  '));
    expect(res.status).toBe(201);
    const view = res.body as SubscriptionView;
    expect(view).toEqual({
      id: view.id,
      kind: 'claude_setup_token',
      label: 'Max at home',
      accountEmail: null,
      accountMeta: {},
      status: 'active',
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      lastUsedAt: null,
      checkedAt: null,
      checkError: null,
      headers: null,
    });
    noSecret(res.body);
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, view.id));
    expect(row).toMatchObject({ ownerUserId: ihor.userId, keyVersion: 1 });
    expect(Buffer.from(row?.ciphertext ?? []).toString('latin1')).not.toContain('sk-ant');
    noSecret(row);
    const used = await credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).useCredentialSecret(
      view.id,
      ihor.userId,
      'test',
    );
    expect(used).toMatchObject({ ok: true, kind: 'claude_setup_token', secret: { token: SETUP_TOKEN } });
  });

  it('takes an Anthropic key, an OpenAI key and a gateway, whose address is shown and headers are not', async () => {
    const anthropic = await add(ihor, { kind: 'anthropic_api_key', label: 'Console', apiKey: ANTHROPIC_KEY });
    const openai = await add(ihor, { kind: 'openai_api_key', label: 'OpenAI', apiKey: ` ${OPENAI_KEY}\n` });
    const gw = await add(ihor, gateway);
    expect([anthropic.kind, openai.kind, gw.kind]).toEqual([
      'anthropic_api_key',
      'openai_api_key',
      'gateway',
    ]);
    expect(gw.accountMeta).toEqual({ baseUrl: 'http://localhost:8300' });
    noSecret([anthropic, openai, gw]);
    const secrets = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
    const opened = await secrets.useCredentialSecret(openai.id, ihor.userId, 'test');
    expect(opened).toMatchObject({ ok: true, secret: { apiKey: OPENAI_KEY } });
    expect(await secrets.useCredentialSecret(gw.id, ihor.userId, 'test')).toMatchObject({
      secret: { headers: { 'x-api-key': GATEWAY_VALUE } },
    });
  });

  it('records the creation by its owner, with no secret in any field', async () => {
    const view = await add(ihor, gateway, 'req-sub-audit');
    const rows = await auditOf(w.t.db, view.id);
    expect(
      rows.map((r) => [r.field, r.action, r.actorKind, r.companyId, r.actorPrincipalId, r.requestId]),
    ).toEqual(
      ['accountMeta', 'kind', 'label', 'ownerUserId', 'status'].map((field) => [
        field,
        'create',
        'user',
        null,
        null,
        'req-sub-audit',
      ]),
    );
    expect(rows.find((r) => r.field === 'ownerUserId')?.newValue).toBe(ihor.userId);
    noSecret(rows);
  });

  it('adds a universal gateway with its own paths, keeping no provider, and lists an older one as it is', async () => {
    const custom = await add(ihor, {
      ...gateway,
      label: 'Airia',
      provider: 'openai',
      baseUrl: 'https://gw.test/anthropic',
      paths: { claude: '', codexApiKey: ' /openai/v1 ' },
    });
    expect(custom.accountMeta).toEqual({
      baseUrl: 'https://gw.test/anthropic',
      paths: { claude: '', codexApiKey: '/openai/v1' },
    });
    const plain = await add(ihor, { ...gateway, label: 'No paths', paths: {} });
    expect(plain.accountMeta).toEqual({ baseUrl: 'http://localhost:8300' });
    const older = await add(ihor, { ...gateway, label: 'Older gateway' });
    await rawDb(w.t.db)
      .update(credentials)
      .set({ accountMeta: { baseUrl: 'http://localhost:8300', provider: 'openai' } })
      .where(eq(credentials.id, older.id));
    const res = await getJson(w.t.app, PATH, { authorization: `Bearer ${ihor.token}` });
    const listed = (res.body as { subscriptions: SubscriptionView[] }).subscriptions;
    expect(listed.find((s) => s.id === older.id)?.accountMeta).toEqual({
      baseUrl: 'http://localhost:8300',
      provider: 'openai',
    });
  });

  it('adds a gateway without headers (a local proxy that needs none)', async () => {
    const res = await as(ihor)('POST', PATH, { ...gateway, label: 'Memory gateway', headers: {} });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'gateway', label: 'Memory gateway' });
  });

  it.each([
    [
      'a setup-token of another shape',
      { ...setupToken(), token: 'sk-ant-api03-not-a-setup-token' },
      'starts with sk-ant-oat01-',
    ],
    ['a setup-token with a space in it', { ...setupToken(), token: `${SETUP_TOKEN} x` }, 'has no spaces'],
    [
      'an Anthropic key of another shape',
      { kind: 'anthropic_api_key', label: 'k', apiKey: SETUP_TOKEN },
      'sk-ant-api',
    ],
    [
      'an OpenAI key of another shape',
      { kind: 'openai_api_key', label: 'k', apiKey: 'pk-123' },
      'starts with sk-',
    ],
    ['a gateway that is not http(s)', { ...gateway, baseUrl: 'ftp://gateway.test' }, 'http or https URL'],
    ['a path without its leading slash', { ...gateway, paths: { claude: 'anthropic' } }, 'starts with /'],
    ['a path with a query', { ...gateway, paths: { codexApiKey: '/v1?x=1' } }, 'starts with /'],
    ['a path over 512 characters', { ...gateway, paths: { claude: `/${'p'.repeat(512)}` } }, 'at most 512'],
    ['a path of an unknown CLI', { ...gateway, paths: { gemini: '/v1' } }, ''],
    [
      'a gateway with 21 headers',
      {
        ...gateway,
        headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`x-h${i}`, GATEWAY_VALUE])),
      },
      'at most 20 headers',
    ],
    ['a header name that is not one', { ...gateway, headers: { 'x key': GATEWAY_VALUE } }, 'header name'],
    [
      'a header value on two lines',
      { ...gateway, headers: { 'x-api-key': `${GATEWAY_VALUE}\nx: y` } },
      'one line',
    ],
    ['an empty name', setupToken('   '), 'A name is required'],
    ['a name over 80 characters', setupToken('n'.repeat(81)), 'at most 80 characters'],
    [
      'a login kind, which is added by signing in',
      { kind: 'claude_oauth', label: 'x', token: SETUP_TOKEN },
      '',
    ],
    ['no secret at all', { kind: 'claude_setup_token', label: 'x' }, ''],
  ])('refuses %s with 400, and never echoes the secret', async (_, body, message) => {
    const res = await as(ihor)('POST', PATH, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'invalid_request' } });
    expect((res.body as { error: { message: string } }).error.message).toContain(message);
    noSecret(res.body);
  });
});

describe('GET /api/me/subscriptions', () => {
  it("lists the caller's own subscriptions, oldest first, as metadata only", async () => {
    const mine = await add(other, setupToken('First'));
    const second = await add(other, { kind: 'anthropic_api_key', label: 'Second', apiKey: ANTHROPIC_KEY });
    const res = await getJson(w.t.app, PATH, { authorization: `Bearer ${other.token}` });
    expect(res.status).toBe(200);
    const listed = (res.body as { subscriptions: SubscriptionView[] }).subscriptions;
    expect(listed.map((s) => s.id)).toEqual([mine.id, second.id]);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      [
        'accountEmail',
        'accountMeta',
        'checkError',
        'checkedAt',
        'createdAt',
        'headers',
        'id',
        'kind',
        'label',
        'lastUsedAt',
        'status',
        'updatedAt',
      ].sort(),
    );
    noSecret(res.body);
    const theirs = await getJson(w.t.app, PATH, { authorization: `Bearer ${ihor.token}` });
    const ids = (theirs.body as { subscriptions: SubscriptionView[] }).subscriptions.map((s) => s.id);
    expect(ids).not.toContain(mine.id);
  });

  it('is empty for a person with none', async () => {
    const fresh = await addUser(w.t.db, w.fake);
    expect(await as(fresh)('GET', PATH)).toMatchObject({ status: 200, body: { subscriptions: [] } });
  });
});

describe('PATCH and DELETE /api/me/subscriptions/:credentialId', () => {
  it('renames, recording the change; the same name records nothing', async () => {
    const view = await add(ihor, setupToken('Old name'));
    const res = await as(ihor, 'req-rename')('PATCH', `${PATH}/${view.id}`, { label: ' New name ' });
    expect(res).toMatchObject({ status: 200, body: { id: view.id, label: 'New name' } });
    noSecret(res.body);
    const same = await as(ihor)('PATCH', `${PATH}/${view.id}`, { label: 'New name' });
    expect(same).toMatchObject({ status: 200, body: { label: 'New name' } });
    const updates = (await auditOf(w.t.db, view.id)).filter((r) => r.action === 'update');
    expect(updates.map((r) => [r.field, r.oldValue, r.newValue, r.requestId])).toEqual([
      ['label', 'Old name', 'New name', 'req-rename'],
    ]);
    expect(await as(ihor)('PATCH', `${PATH}/${view.id}`, { label: '' })).toMatchObject({ status: 400 });
  });

  it("changes a gateway's address and paths, keeping its headers sealed and recording the change", async () => {
    const view = await add(ihor, { ...gateway, label: 'Memory' });
    const path = `${PATH}/${view.id}`;
    const moved = await as(ihor, 'req-gw')('PATCH', path, {
      baseUrl: 'http://127.0.0.1:8300',
      paths: { codexChatgpt: '/backend-api/codex/' },
    });
    expect(moved).toMatchObject({
      status: 200,
      body: {
        label: 'Memory',
        accountMeta: { baseUrl: 'http://127.0.0.1:8300', paths: { codexChatgpt: '/backend-api/codex/' } },
      },
    });
    const renamed = await as(ihor)('PATCH', path, { label: 'Memory 8300' });
    expect((renamed.body as SubscriptionView).accountMeta).toEqual(
      (moved.body as SubscriptionView).accountMeta,
    );
    const reset = await as(ihor)('PATCH', path, { paths: {} });
    expect((reset.body as SubscriptionView).accountMeta).toEqual({ baseUrl: 'http://127.0.0.1:8300' });
    const same = await as(ihor)('PATCH', path, { baseUrl: 'http://127.0.0.1:8300' });
    expect(same).toMatchObject({ status: 200, body: { accountMeta: { baseUrl: 'http://127.0.0.1:8300' } } });
    const updates = (await auditOf(w.t.db, view.id)).filter((r) => r.action === 'update');
    expect(updates.map((r) => r.field)).toEqual(['accountMeta', 'label', 'accountMeta']);
    expect(updates[0]).toMatchObject({
      requestId: 'req-gw',
      newValue: (moved.body as SubscriptionView).accountMeta,
    });
    const secrets = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
    expect(await secrets.useCredentialSecret(view.id, ihor.userId, 'test')).toMatchObject({
      secret: { headers: { 'x-api-key': GATEWAY_VALUE } },
    });
    noSecret(updates);
  });

  it('refuses an address or paths for a subscription that is not a gateway (422), and a change of nothing (400)', async () => {
    const view = await add(ihor, setupToken('Token'));
    for (const body of [{ baseUrl: 'http://127.0.0.1:8300' }, { label: 'Token', paths: {} }]) {
      expect(await as(ihor)('PATCH', `${PATH}/${view.id}`, body)).toMatchObject({
        status: 422,
        body: { error: { code: 'not_a_gateway' } },
      });
    }
    expect(await as(ihor)('PATCH', `${PATH}/${view.id}`, {})).toMatchObject({ status: 400 });
    expect(await as(ihor)('PATCH', `${PATH}/${view.id}`, { baseUrl: 'ftp://x.test' })).toMatchObject({
      status: 400,
    });
  });

  it('removes with 204, keeping the audit rows, and the subscription is gone from the list', async () => {
    const view = await add(ihor, gateway);
    expect((await as(ihor, 'req-remove')('DELETE', `${PATH}/${view.id}`)).status).toBe(204);
    const listed = (await as(ihor)('GET', PATH)).body as { subscriptions: SubscriptionView[] };
    expect(listed.subscriptions.map((s) => s.id)).not.toContain(view.id);
    const rows = await auditOf(w.t.db, view.id);
    expect(rows.filter((r) => r.action === 'delete').map((r) => [r.field, r.newValue, r.requestId])).toEqual(
      ['accountMeta', 'kind', 'label', 'ownerUserId', 'status'].map((f) => [f, null, 'req-remove']),
    );
    expect(rows.filter((r) => r.action === 'create')).toHaveLength(5);
    noSecret(rows);
    expect(await as(ihor)('DELETE', `${PATH}/${view.id}`)).toMatchObject({ status: 404 });
  });

  it("answers 404 for another person's subscription, an unknown one and a malformed id, changing nothing", async () => {
    const theirs = await add(other, setupToken('Not yours'));
    for (const id of [theirs.id, '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b', 'not-an-id']) {
      const renamed = await as(ihor)('PATCH', `${PATH}/${id}`, { label: 'Mine now' });
      expect(renamed).toMatchObject({ status: 404, body: { error: { code: 'credential_not_found' } } });
      expect(await as(ihor)('DELETE', `${PATH}/${id}`)).toMatchObject({ status: 404 });
    }
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, theirs.id));
    expect(row).toMatchObject({ label: 'Not yours', ownerUserId: other.userId });
  });
});

describe('who may manage subscriptions', () => {
  it('refuses an API key on every route with 403 session_required, even the owner’s own', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const added = await call(w, `fake:${person.subject}`)('POST', PATH, setupToken());
    const view = added.body as SubscriptionView;
    const withKey = call(w, key);
    for (const [method, path, body] of [
      ['GET', PATH, undefined],
      ['POST', PATH, setupToken()],
      ['PATCH', `${PATH}/${view.id}`, { label: 'x' }],
      ['DELETE', `${PATH}/${view.id}`, undefined],
    ] as const) {
      const res = await withKey(method, path, body);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: 'session_required' } });
    }
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, view.id));
    expect(row?.label).toBe('Max at home');
  });

  it('asks for a credential (401) and answers 503 when sign-in is off', async () => {
    expect(await call(w, undefined)('GET', PATH)).toMatchObject({ status: 401 });
    const off = await createTestApp();
    try {
      expect((await getJson(off.app, PATH)).status).toBe(503);
    } finally {
      await off.close();
    }
  });

  it('is in the OpenAPI document under subscriptions', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as { paths: Record<string, object> };
    expect(Object.keys(doc.paths[PATH] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths[`${PATH}/{credentialId}`] ?? {}).sort()).toEqual(['delete', 'patch']);
  });

  it('never wrote a secret to the log', () => {
    expect(w.t.logs.length).toBeGreaterThan(0);
    noSecret(w.t.logs);
  });
});
