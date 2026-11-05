import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { getJson, seedCompany, TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addPerson, seedApiKey } from '../../../fixtures/auth.ts';
import { addUser, call, type LinkedUser } from '../../../fixtures/companies.ts';
import {
  claudeLogin,
  getLimits,
  json,
  type LimitsWorld,
  limitsOf,
  limitsWorld,
  URLS,
  usesOf,
} from '../../../fixtures/credentials/providers.ts';

const ACCESS = 'sk-ant-oat01-LIMITSaccessNEVERlogged';
const REFRESH = 'sk-ant-ort01-LIMITSrefreshNEVERlogged';
const SETUP_TOKEN = 'sk-ant-oat01-LIMITSsetupNEVERlogged_0123456789';
const PROVIDER_SECRET = 'provider-answer-NEVERlogged';
const MINUTE = 60_000;
const IN_A_DAY = Date.parse(TEST_NOW) + 24 * 60 * MINUTE;

const USAGE = {
  five_hour: { utilization: 12, resets_at: '2026-11-03T15:00:00Z' },
  seven_day: { utilization: 50, resets_at: '2026-11-07T02:00:00Z' },
  echo: PROVIDER_SECRET,
};

let w: LimitsWorld;
beforeAll(async () => {
  w = await limitsWorld();
});
afterAll(() => w.t.close());
beforeEach(() => {
  w.provider.reset();
  w.clock.set(TEST_NOW);
});

/** A person with a Claude login that expires in a day, and its id. */
async function personWithLogin(label = 'Max') {
  const user = await addUser(w.t.db, w.fake);
  const view = await w.store.storeCredential({
    ownerUserId: user.userId,
    kind: 'claude_oauth',
    label,
    secret: claudeLogin({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: IN_A_DAY }),
    accountEmail: 'ihor@example.com',
  });
  return { user, id: view.id };
}

const add = async (user: LinkedUser, body: Record<string, unknown>) =>
  (await call(w, user.token)('POST', '/api/me/subscriptions', body)).body as { id: string };

describe('GET /api/me/subscriptions/limits', () => {
  it("answers each of the caller's subscriptions; keys and gateways have no limits and are never opened", async () => {
    const { user, id } = await personWithLogin();
    const key = await add(user, {
      kind: 'anthropic_api_key',
      label: 'Key',
      apiKey: 'sk-ant-api03-KEYnotSHOWN',
    });
    const gateway = await add(user, {
      kind: 'gateway',
      label: 'Gateway',
      baseUrl: 'http://localhost:8300',
      headers: { 'x-api-key': 'gw-NOTshown' },
    });
    w.provider.always(URLS.claudeUsage, json(200, USAGE));
    const res = await getLimits(w, user.token);
    expect(res.status).toBe(200);
    expect(res.body.limits.map((l) => l.credentialId)).toEqual([id, key.id, gateway.id]);
    expect(res.body.limits[0]).toEqual({
      credentialId: id,
      kind: 'claude_oauth',
      label: 'Max',
      accountEmail: 'ihor@example.com',
      source: 'usage_api',
      checkedAt: TEST_NOW,
      windows: [
        {
          id: 'five_hour',
          label: '5-hour limit',
          usedPercent: 12,
          resetsAt: '2026-11-03T15:00:00.000Z',
          reached: false,
        },
        {
          id: 'seven_day',
          label: 'Weekly limit',
          usedPercent: 50,
          resetsAt: '2026-11-07T02:00:00.000Z',
          reached: false,
        },
      ],
      error: null,
      stale: false,
    });
    for (const [entry, kind] of [
      [res.body.limits[1], 'anthropic_api_key'],
      [res.body.limits[2], 'gateway'],
    ] as const) {
      expect(entry).toMatchObject({
        kind,
        source: 'none',
        checkedAt: null,
        windows: [],
        error: null,
        stale: false,
      });
    }
    expect(await usesOf(w.t.db, key.id)).toEqual([]);
    expect(await usesOf(w.t.db, gateway.id)).toEqual([]);
    expect(w.provider.calls.map((c) => c.url)).toEqual([URLS.claudeUsage]);
  });

  it("shows nobody another person's subscriptions and checks only the caller's", async () => {
    const { id } = await personWithLogin();
    const other = await addUser(w.t.db, w.fake);
    const res = await getLimits(w, other.token, '?refresh=1');
    expect(res.body.limits).toEqual([]);
    expect(w.provider.calls).toEqual([]);
    expect(await usesOf(w.t.db, id)).toEqual([]);
  });

  it('refuses an API key (403 session_required), no credential (401) and a bad refresh value (400)', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const withKey = await getLimits(w, key);
    expect(withKey.status).toBe(403);
    expect(withKey.body).toMatchObject({ error: { code: 'session_required' } });
    expect((await getJson(w.t.app, '/api/me/subscriptions/limits')).status).toBe(401);
    const user = await addUser(w.t.db, w.fake);
    expect((await getLimits(w, user.token, '?refresh=2')).status).toBe(400);
    expect(w.provider.calls).toEqual([]);
  });

  it('checks a subscription the first time, then answers from the cache; refresh=1 checks again past 5 minutes', async () => {
    const { user, id } = await personWithLogin();
    w.provider.always(URLS.claudeUsage, json(200, USAGE));
    await limitsOf(w, user);
    expect((await limitsOf(w, user)).get(id)?.checkedAt).toBe(TEST_NOW);
    w.clock.advance(5 * MINUTE - 1);
    expect((await limitsOf(w, user, '?refresh=1')).get(id)?.checkedAt).toBe(TEST_NOW);
    w.clock.advance(1);
    expect((await limitsOf(w, user)).get(id)?.checkedAt).toBe(TEST_NOW);
    const checked = (await limitsOf(w, user, '?refresh=true')).get(id);
    expect(checked?.checkedAt).toBe(new Date(Date.parse(TEST_NOW) + 5 * MINUTE).toISOString());
    expect(w.provider.callsTo(URLS.claudeUsage)).toHaveLength(2);
    expect((await usesOf(w.t.db, id)).map((u) => u.purpose)).toEqual(['usage_check', 'usage_check']);
  });

  it('waits 15 minutes between two probes of a setup-token', async () => {
    const user = await addUser(w.t.db, w.fake);
    const token = await add(user, { kind: 'claude_setup_token', label: 'Setup', token: SETUP_TOKEN });
    w.provider.always(
      URLS.messages,
      () =>
        new Response('{}', { status: 200, headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.1' } }),
    );
    expect((await limitsOf(w, user)).get(token.id)?.source).toBe('message_headers');
    w.clock.advance(14 * MINUTE);
    await limitsOf(w, user, '?refresh=1');
    expect(w.provider.callsTo(URLS.messages)).toHaveLength(1);
    w.clock.advance(MINUTE);
    await limitsOf(w, user, '?refresh=1');
    expect(w.provider.callsTo(URLS.messages)).toHaveLength(2);
  });

  it('runs one check per subscription at a time: concurrent callers share it', async () => {
    const { user, id } = await personWithLogin();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.provider.always(URLS.claudeUsage, async () => {
      await gate;
      return json(200, USAGE)({} as never);
    });
    const first = limitsOf(w, user, '?refresh=1');
    const second = limitsOf(w, user, '?refresh=1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.get(id)?.windows).toHaveLength(2);
    expect(b.get(id)).toEqual(a.get(id));
    expect(w.provider.callsTo(URLS.claudeUsage)).toHaveLength(1);
    expect(await usesOf(w.t.db, id)).toHaveLength(1);
  });

  it('keeps the last good windows, marked stale, when the provider rate limits (429) or refuses (403) the check', async () => {
    const { user, id } = await personWithLogin();
    w.provider.once(URLS.claudeUsage, json(200, USAGE));
    const good = (await limitsOf(w, user)).get(id);
    w.provider.once(URLS.claudeUsage, json(429, { error: PROVIDER_SECRET }));
    w.clock.advance(5 * MINUTE);
    const limited = (await limitsOf(w, user, '?refresh=1')).get(id);
    expect(limited).toMatchObject({
      windows: good?.windows,
      error: { code: 'rate_limited', message: 'The provider rate limited the usage check. Try again later.' },
      stale: true,
      checkedAt: new Date(Date.parse(TEST_NOW) + 5 * MINUTE).toISOString(),
    });
    w.provider.once(URLS.claudeUsage, json(403, { error: PROVIDER_SECRET }));
    w.clock.advance(5 * MINUTE);
    const refused = (await limitsOf(w, user, '?refresh=1')).get(id);
    expect(refused).toMatchObject({ windows: good?.windows, error: { code: 'usage_refused' }, stale: true });
    w.provider.once(URLS.claudeUsage, json(200, { five_hour: { utilization: 99 } }));
    w.clock.advance(5 * MINUTE);
    const fresh = (await limitsOf(w, user, '?refresh=1')).get(id);
    expect(fresh).toMatchObject({
      error: null,
      stale: false,
      windows: [{ id: 'five_hour', usedPercent: 99 }],
    });
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id));
    expect(row?.status).toBe('active');
  });

  it('has no windows and is not stale when the first check fails', async () => {
    const { user, id } = await personWithLogin();
    w.provider.always(URLS.claudeUsage, json(429, {}));
    expect((await limitsOf(w, user)).get(id)).toMatchObject({
      windows: [],
      error: { code: 'rate_limited' },
      stale: false,
      checkedAt: TEST_NOW,
    });
  });

  it('shows a revoked subscription as revoked, opening nothing', async () => {
    const { user, id } = await personWithLogin();
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, id));
    expect((await limitsOf(w, user)).get(id)?.error).toEqual({
      code: 'credential_revoked',
      message: 'This subscription was revoked; add it again.',
    });
    expect(w.provider.calls).toEqual([]);
    expect(await usesOf(w.t.db, id)).toEqual([]);
  });

  it('answers check_failed for a secret that does not open, logging only the failure’s name', async () => {
    const { user, id } = await personWithLogin();
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id));
    const bytes = new Uint8Array(row?.ciphertext ?? []);
    bytes[0] = (bytes[0] as number) ^ 0xff;
    await rawDb(w.t.db).update(credentials).set({ ciphertext: bytes }).where(eq(credentials.id, id));
    expect((await limitsOf(w, user)).get(id)?.error?.code).toBe('check_failed');
    expect(
      w.t.logs.some((l) => l.msg === 'usage check failed unexpectedly' && l.error === 'SecretOpenError'),
    ).toBe(true);
  });

  it('logs the credential and the refusal, never a token or a provider answer', async () => {
    const { user, id } = await personWithLogin();
    const setup = await add(user, { kind: 'claude_setup_token', label: 'Setup', token: SETUP_TOKEN });
    w.provider
      .once(URLS.claudeUsage, json(401, { error: PROVIDER_SECRET }))
      .once(URLS.claudeToken, json(200, { access_token: `${ACCESS}-new`, refresh_token: `${REFRESH}-new` }))
      .once(URLS.claudeUsage, json(429, { error: PROVIDER_SECRET }))
      .once(URLS.messages, json(500, { error: PROVIDER_SECRET }));
    const limits = await limitsOf(w, user);
    expect(limits.get(id)?.error?.code).toBe('rate_limited');
    expect(limits.get(setup.id)?.error?.code).toBe('provider_unavailable');
    const failures = w.t.logs.filter((l) => l.msg === 'usage check failed');
    expect(failures.map((l) => [l.credentialId, l.kind, l.code])).toEqual(
      expect.arrayContaining([
        [id, 'claude_oauth', 'rate_limited'],
        [setup.id, 'claude_setup_token', 'provider_unavailable'],
      ]),
    );
    const logs = JSON.stringify(w.t.logs);
    for (const secret of [ACCESS, REFRESH, SETUP_TOKEN, PROVIDER_SECRET]) expect(logs).not.toContain(secret);
  });

  it('is in the OpenAPI document with its shape', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths['/api/me/subscriptions/limits']?.get?.responses).toHaveProperty('200');
    expect(doc.components.schemas).toHaveProperty('SubscriptionLimits');
    expect(doc.components.schemas).toHaveProperty('LimitWindow');
  });
});
