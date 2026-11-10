import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import {
  createTestApp,
  FakeIdentityProvider,
  fixedClock,
  getJson,
  seedCompany,
  type TestApp,
  testConfig,
} from '@mwc/testkit';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import type { AccessProfileView } from '../../../../src/modules/credentials/schemas/profiles.ts';
import type { SignInView } from '../../../../src/modules/credentials/schemas/sign-in.ts';
import type { SubscriptionView } from '../../../../src/modules/credentials/schemas.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import {
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_CODE,
  CLAUDE_CREDENTIALS,
  CODEX_AUTH,
  CODEX_DEVICE_URL,
  CODEX_USER_CODE,
  SECRETS,
} from '../../../fixtures/credentials/sign-in/cli.ts';
import {
  claudeScript,
  codexScript,
  FakeLoginHelper,
  settle,
  until,
} from '../../../fixtures/credentials/sign-in/helper.ts';
import { addSubscription, PROFILES, revokeSubscription, seedProfile } from '../../../fixtures/org.ts';
import { type AuthWorld, addPerson, bearer, seedApiKey } from '../../../fixtures/platform/auth.ts';

const SIGN_IN = '/api/me/subscriptions/sign-in';
const helper = new FakeLoginHelper();
const keyring = ephemeralKeyring();
/** What the app registered to end at shutdown. */
const stops: (() => Promise<void>)[] = [];
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  const clock = fixedClock();
  const fake = new FakeIdentityProvider({ clock });
  const onShutdown = (stop: () => Promise<void>) => void stops.push(stop);
  const t = await createTestApp({ clock, identity: fake, loginHelper: helper, keyring, onShutdown });
  w = { t, fake, clock, deps: { db: t.db, config: testConfig, logger: t.logger, identity: fake } };
  ihor = await addUser(t.db, fake);
  other = await addUser(t.db, fake);
});
afterAll(() => w.t.close());
beforeEach(() => {
  helper.script = claudeScript();
});

const as = (user: LinkedUser, requestId?: string) => call(w, user.token, requestId);
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

async function begin(user: LinkedUser, body: Record<string, unknown>): Promise<SignInView> {
  const res = await as(user)('POST', SIGN_IN, body);
  if (res.status !== 201)
    throw new Error(`POST ${SIGN_IN} answered ${res.status}: ${JSON.stringify(res.body)}`);
  await settle();
  return res.body as SignInView;
}
const poll = async (user: LinkedUser, id: string) =>
  (await as(user)('GET', `${SIGN_IN}/${id}`)).body as SignInView;
const cancel = (user: LinkedUser, id: string) => as(user)('DELETE', `${SIGN_IN}/${id}`);

describe('Sign in with Claude over HTTP', () => {
  it('201 starting, the address on a poll, the code, then done with the subscription listed', async () => {
    const res = await as(ihor)('POST', SIGN_IN, { provider: 'claude' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ provider: 'claude', state: 'starting', url: null });
    const id = (res.body as SignInView).id;
    await settle();
    expect(await poll(ihor, id)).toMatchObject({ state: 'waiting_for_code', url: CLAUDE_AUTHORIZE_URL });
    const sent = await as(ihor)('POST', `${SIGN_IN}/${id}/code`, { code: ` ${CLAUDE_CODE}\n` });
    expect(sent).toMatchObject({ status: 200, body: { state: 'completing' } });
    expect(helper.last.written).toEqual([`${CLAUDE_CODE}\r`]);
    await until(async () => (await poll(ihor, id)).state === 'done', 'done');
    const finished = await poll(ihor, id);
    const list = (await as(ihor)('GET', '/api/me/subscriptions')).body as {
      subscriptions: SubscriptionView[];
    };
    expect(list.subscriptions).toContainEqual(
      expect.objectContaining({
        id: finished.credentialId,
        kind: 'claude_oauth',
        label: 'Claude · ihor@example.test',
        accountEmail: 'ihor@example.test',
      }),
    );
    noSecret([res.body, sent.body, finished, list]);
  });

  it('refuses a code that is not one word, and a code when none is awaited', async () => {
    const started = await begin(ihor, { provider: 'claude' });
    for (const bad of ['short', 'two words here', `${CLAUDE_CODE}\nexit`, '']) {
      const res = await as(ihor)('POST', `${SIGN_IN}/${started.id}/code`, { code: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(helper.last.written).toEqual([]);
    await cancel(ihor, started.id);
    const late = await as(ihor)('POST', `${SIGN_IN}/${started.id}/code`, { code: CLAUDE_CODE });
    expect(late).toMatchObject({ status: 409, body: { error: { code: 'sign_in_not_waiting' } } });
  });
});

describe('Sign in with OpenAI over HTTP', () => {
  it('shows the device page and code, takes no code, and ends done once Codex finishes', async () => {
    helper.script = codexScript();
    const started = await begin(ihor, { provider: 'openai', label: 'ChatGPT Pro' });
    expect(await poll(ihor, started.id)).toMatchObject({
      state: 'waiting_for_user',
      url: CODEX_DEVICE_URL,
      userCode: CODEX_USER_CODE,
    });
    const refused = await as(ihor)('POST', `${SIGN_IN}/${started.id}/code`, { code: CLAUDE_CODE });
    expect(refused.status).toBe(409);
    helper.last.exit(0);
    await until(async () => (await poll(ihor, started.id)).state === 'done', 'done');
    const list = (await as(ihor)('GET', '/api/me/subscriptions')).body as {
      subscriptions: SubscriptionView[];
    };
    expect(list.subscriptions).toContainEqual(
      expect.objectContaining({
        kind: 'codex_oauth',
        label: 'ChatGPT Pro',
        accountMeta: { planType: 'pro' },
      }),
    );
  });
});

describe('Sign in again over HTTP', () => {
  const store = () => credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
  /** A login of the user's that needs signing in again, of `kind`, with its old account. */
  async function stale(kind: 'claude_oauth' | 'codex_oauth', accountEmail: string) {
    const secret =
      kind === 'claude_oauth'
        ? { credentials: { claudeAiOauth: { accessToken: 'sk-ant-oat01-FAKEold' } }, account: null }
        : { auth: { tokens: { access_token: 'eyFAKEold' } } };
    const view = await store().storeCredential({
      ownerUserId: ihor.userId,
      kind,
      label: 'Mine',
      secret,
      accountEmail,
    } as Parameters<ReturnType<typeof store>['storeCredential']>[0]);
    await store().setCredentialStatus(view.id, ihor.userId, 'needs_sign_in');
    return view;
  }
  const subscriptionsOf = async (user: LinkedUser) =>
    ((await as(user)('GET', '/api/me/subscriptions')).body as { subscriptions: SubscriptionView[] })
      .subscriptions;

  it('renews the same subscription: no new one, its secret replaced, active, its name and profiles kept', async () => {
    const old = await stale('claude_oauth', 'ihor@example.test');
    const profile = await seedProfile(w.t.db, ihor.userId, { credentialId: old.id });
    const before = (await subscriptionsOf(ihor)).length;
    const res = await as(ihor, 'req-again')('POST', SIGN_IN, {
      provider: 'claude',
      credentialId: old.id,
      label: 'X',
    });
    expect(res).toMatchObject({
      status: 201,
      body: { state: 'starting', credentialId: null, accountChanged: false },
    });
    const id = (res.body as SignInView).id;
    await settle();
    await as(ihor)('POST', `${SIGN_IN}/${id}/code`, { code: CLAUDE_CODE });
    await until(async () => (await poll(ihor, id)).state === 'done', 'done');
    expect(await poll(ihor, id)).toMatchObject({
      credentialId: old.id,
      accountChanged: false,
      message: null,
    });
    const after = await subscriptionsOf(ihor);
    expect(after).toHaveLength(before);
    expect(after.find((s) => s.id === old.id)).toMatchObject({
      label: 'Mine',
      status: 'active',
      accountEmail: 'ihor@example.test',
      accountMeta: { organizationName: "Ihor's Organization", subscriptionType: 'max' },
    });
    expect(await store().useCredentialSecret(old.id, ihor.userId, 'test')).toMatchObject({
      secret: { credentials: CLAUDE_CREDENTIALS },
    });
    const profiles = (await as(ihor)('GET', PROFILES)).body as { profiles: AccessProfileView[] };
    expect(profiles.profiles.find((p) => p.id === profile.id)?.subscription).toMatchObject({
      id: old.id,
      status: 'active',
    });
    const audit = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(eq(auditLog.requestId, 'req-again'))
      .orderBy(asc(auditLog.id));
    expect(audit.map((r) => [r.entityId, r.actorKind, r.action, r.field])).toEqual([
      [old.id, 'user', 'replace_secret', 'secret'],
      [old.id, 'user', 'update', 'accountMeta'],
      [old.id, 'user', 'update', 'status'],
    ]);
    noSecret([res.body, after, audit]);
  });

  it('says so when the login is of another account, and renews an OpenAI login too', async () => {
    helper.script = codexScript();
    const old = await stale('codex_oauth', 'someone@example.test');
    const started = await begin(ihor, { provider: 'openai', credentialId: old.id });
    helper.last.exit(0);
    await until(async () => (await poll(ihor, started.id)).state === 'done', 'done');
    expect(await poll(ihor, started.id)).toMatchObject({ credentialId: old.id, accountChanged: true });
    expect((await subscriptionsOf(ihor)).find((s) => s.id === old.id)).toMatchObject({
      label: 'Mine',
      status: 'active',
      accountEmail: 'ihor@example.test',
      accountMeta: { planType: 'pro' },
    });
    expect(await store().useCredentialSecret(old.id, ihor.userId, 'test')).toMatchObject({
      secret: { auth: CODEX_AUTH },
    });
  });

  it("refuses another person's subscription and an unknown id (404), another kind and a revoked one (422)", async () => {
    const theirs = await addSubscription(w, keyring, other.userId, 'claude_oauth');
    const codex = await addSubscription(w, keyring, ihor.userId, 'codex_oauth');
    const key = await addSubscription(w, keyring, ihor.userId, 'anthropic_api_key');
    const revoked = await addSubscription(w, keyring, ihor.userId, 'claude_oauth');
    await revokeSubscription(w.t.db, revoked.id);
    const started = helper.commands.length;
    for (const [credentialId, status, code] of [
      [theirs.id, 404, 'credential_not_found'],
      ['019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b', 404, 'credential_not_found'],
      ['not-an-id', 404, 'credential_not_found'],
      [codex.id, 422, 'sign_in_kind_mismatch'],
      [key.id, 422, 'sign_in_kind_mismatch'],
      [revoked.id, 422, 'credential_revoked'],
    ] as const) {
      const res = await as(ihor)('POST', SIGN_IN, { provider: 'claude', credentialId });
      expect(res, credentialId).toMatchObject({ status, body: { error: { code } } });
    }
    expect(helper.commands.length).toBe(started);
  });
});

describe('the sign-in routes', () => {
  it('allow one active sign-in per person: 409 sign_in_active, and a cancel frees it', async () => {
    const started = await begin(ihor, { provider: 'claude' });
    const again = await as(ihor)('POST', SIGN_IN, { provider: 'openai' });
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'sign_in_active' } } });
    const cancelled = await cancel(ihor, started.id);
    expect(cancelled).toMatchObject({ status: 200, body: { state: 'cancelled' } });
    expect(helper.last.kills).toBe(1);
    const next = await as(ihor)('POST', SIGN_IN, { provider: 'claude' });
    expect(next.status).toBe(201);
    expect((await as(ihor)('GET', `${SIGN_IN}/${started.id}`)).status).toBe(404);
    await cancel(ihor, (next.body as SignInView).id);
  });

  it("answer another person's sign-in and an unknown id with the same 404", async () => {
    const mine = await begin(other, { provider: 'claude' });
    for (const [method, path, body] of [
      ['GET', `${SIGN_IN}/${mine.id}`, undefined],
      ['POST', `${SIGN_IN}/${mine.id}/code`, { code: CLAUDE_CODE }],
      ['DELETE', `${SIGN_IN}/${mine.id}`, undefined],
      ['GET', `${SIGN_IN}/019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b`, undefined],
    ] as const) {
      const res = await as(ihor)(method, path, body);
      expect(res, `${method} ${path}`).toMatchObject({
        status: 404,
        body: { error: { code: 'sign_in_not_found' } },
      });
    }
    expect((await poll(other, mine.id)).state).toBe('waiting_for_code');
    await cancel(other, mine.id);
  });

  it('refuse an API key (403 session_required) and no credential (401)', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const res = await w.t.app.request(SIGN_IN, {
      method: 'POST',
      headers: { ...bearer(key), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'claude' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'session_required' } });
    expect((await getJson(w.t.app, `${SIGN_IN}/x`)).status).toBe(401);
  });

  it('refuse an unknown provider and a name that does not fit (400)', async () => {
    for (const body of [{ provider: 'gemini' }, {}, { provider: 'claude', label: 'x'.repeat(81) }]) {
      expect((await as(ihor)('POST', SIGN_IN, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('write no token, file, pasted code or address to the logs', async () => {
    const started = await begin(ihor, { provider: 'claude' });
    await as(ihor)('POST', `${SIGN_IN}/${started.id}/code`, { code: CLAUDE_CODE });
    await until(async () => (await poll(ihor, started.id)).state === 'done', 'done');
    const text = JSON.stringify(w.t.logs);
    for (const secret of [...SECRETS, CLAUDE_AUTHORIZE_URL]) expect(text).not.toContain(secret);
  });

  it('end when the server shuts down: the sign-ins in progress cancelled and their sandboxes removed', async () => {
    const started = await begin(ihor, { provider: 'claude' });
    // The sign-ins' stop, and the runner hub's (the app made its own).
    expect(stops).toHaveLength(2);
    await Promise.all(stops.map((stop) => stop()));
    expect([helper.last.kills, helper.last.removed]).toEqual([1, true]);
    expect(await poll(ihor, started.id)).toMatchObject({
      state: 'cancelled',
      message: 'The sign-in was interrupted (the server restarted). Start again.',
    });
  });

  it('are in the API document', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as { paths: Record<string, object> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([SIGN_IN, `${SIGN_IN}/{signInId}`, `${SIGN_IN}/{signInId}/code`]),
    );
  });
});

describe('without a sign-in helper (MWC_LOGIN_HELPER=none)', () => {
  let off: TestApp;
  beforeAll(async () => {
    off = await createTestApp({ db: w.t.db, identity: w.fake, migrate: false });
  });

  it('answers 503 sign_in_unavailable', async () => {
    const res = await off.app.request(SIGN_IN, {
      method: 'POST',
      headers: { ...bearer(ihor.token), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'sign_in_unavailable' } });
  });
});
