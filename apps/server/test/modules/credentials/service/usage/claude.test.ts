import { auditLog, credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claudeWindows } from '../../../../../src/modules/credentials/service/usage/claude.ts';
import { addUser, type LinkedUser } from '../../../../fixtures/companies.ts';
import {
  claudeLogin,
  json,
  type LimitsWorld,
  limitsOf,
  limitsWorld,
  URLS,
} from '../../../../fixtures/credentials/providers.ts';

const ACCESS = 'sk-ant-oat01-CLAUDEaccessOLD';
const NEW_ACCESS = 'sk-ant-oat01-CLAUDEaccessNEW';
const REFRESH = 'sk-ant-ort01-CLAUDErefreshOLD';
const NEW_REFRESH = 'sk-ant-ort01-CLAUDErefreshNEW';
const NOW = Date.parse(TEST_NOW);
const MINUTE = 60_000;
const USAGE = { five_hour: { utilization: 30, resets_at: '2026-11-03T15:00:00Z' } };

let w: LimitsWorld;
beforeAll(async () => {
  w = await limitsWorld();
});
afterAll(() => w.t.close());
beforeEach(() => {
  w.provider.reset();
  w.clock.set(TEST_NOW);
});

/** A person with a Claude login of these tokens. */
async function login(tokens: Parameters<typeof claudeLogin>[0], status?: 'needs_sign_in') {
  const user = await addUser(w.t.db, w.fake);
  const view = await w.store.storeCredential({
    ownerUserId: user.userId,
    kind: 'claude_oauth',
    label: 'Max',
    secret: claudeLogin(tokens),
  });
  if (status) await rawDb(w.t.db).update(credentials).set({ status }).where(eq(credentials.id, view.id));
  return { user, id: view.id };
}

const rowOf = async (id: string) =>
  (await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id)))[0];
const auditOf = (id: string) =>
  rawDb(w.t.db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'credential'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));
const stored = async (user: LinkedUser, id: string) => {
  const used = await w.store.useCredentialSecret(id, user.userId, 'test_read');
  if (!used.ok || used.kind !== 'claude_oauth') throw new Error('not a Claude login');
  return used.secret;
};

describe('claudeWindows', () => {
  it('reads the four windows as percentages, leaving out the missing ones and the rest of the answer', () => {
    expect(
      claudeWindows({
        five_hour: { utilization: 12.345, resets_at: '2026-11-03T15:00:00Z' },
        seven_day: null,
        seven_day_opus: { utilization: 100, resets_at: null },
        seven_day_sonnet: { resets_at: '2026-11-07T00:00:00Z' },
        seven_day_oauth_apps: { utilization: 5 },
        extra_usage: { is_enabled: true, utilization: 3 },
      }),
    ).toEqual([
      {
        id: 'five_hour',
        label: '5-hour limit',
        usedPercent: 12.35,
        resetsAt: '2026-11-03T15:00:00.000Z',
        reached: false,
      },
      { id: 'seven_day_opus', label: 'Opus weekly limit', usedPercent: 100, resetsAt: null, reached: true },
    ]);
    expect(claudeWindows({})).toEqual([]);
  });
});

describe('a Claude login', () => {
  it('asks the usage API with its access token and the OAuth beta header, no redirects and a deadline', async () => {
    const { user, id } = await login({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: NOW + 60 * MINUTE,
    });
    w.provider.always(URLS.claudeUsage, json(200, { ...USAGE, seven_day_sonnet: { utilization: 1 } }));
    const limits = (await limitsOf(w, user)).get(id);
    expect(limits?.windows.map((x) => [x.id, x.usedPercent])).toEqual([
      ['five_hour', 30],
      ['seven_day_sonnet', 1],
    ]);
    expect(w.provider.calls).toEqual([
      {
        url: URLS.claudeUsage,
        method: 'GET',
        headers: { authorization: `Bearer ${ACCESS}`, 'anthropic-beta': 'oauth-2025-04-20' },
        body: undefined,
        redirect: 'error',
        hasDeadline: true,
      },
    ]);
  });

  it('refreshes a token about to expire first, seals the new set in place of the old one and uses it', async () => {
    const { user, id } = await login({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: NOW + 4 * MINUTE,
      scopes: ['user:inference', 'user:profile'],
    });
    const before = await rowOf(id);
    w.provider
      .once(
        URLS.claudeToken,
        json(200, {
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          expires_in: 28800,
          scope: 'user:inference',
        }),
      )
      .always(URLS.claudeUsage, json(200, USAGE));
    expect((await limitsOf(w, user, '?refresh=1')).get(id)?.error).toBeNull();
    expect(w.provider.callsTo(URLS.claudeToken)[0]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: {
        grant_type: 'refresh_token',
        refresh_token: REFRESH,
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        scope: 'user:inference user:profile',
      },
    });
    expect(w.provider.callsTo(URLS.claudeUsage)[0]?.headers.authorization).toBe(`Bearer ${NEW_ACCESS}`);
    const secret = await stored(user, id);
    expect(secret.credentials.claudeAiOauth).toEqual({
      subscriptionType: 'max',
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: NOW + 28800 * 1000,
      scopes: ['user:inference'],
    });
    expect(secret.account).toEqual({ emailAddress: 'ihor@example.com', organizationName: 'Ihor' });
    const after = await rowOf(id);
    expect(Buffer.from(after?.ciphertext ?? []).equals(Buffer.from(before?.ciphertext ?? []))).toBe(false);
    expect(JSON.stringify(after)).not.toContain(REFRESH);
    const audit = (await auditOf(id)).filter((r) => r.action === 'replace_secret');
    expect(audit.map((r) => [r.actorKind, r.field, r.oldValue, r.newValue])).toEqual([
      ['system', 'secret', { keyVersion: 1 }, { keyVersion: 1, purpose: 'usage_check' }],
    ]);
    expect(JSON.stringify(await auditOf(id))).not.toMatch(/CLAUDE(access|refresh)/);
  });

  it('keeps the refresh token and the scopes the refresh does not return, and no expiry it does not give', async () => {
    const { user, id } = await login({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW - MINUTE });
    w.provider
      .once(URLS.claudeToken, json(200, { access_token: NEW_ACCESS }))
      .always(URLS.claudeUsage, json(200, USAGE));
    await limitsOf(w, user);
    expect(w.provider.callsTo(URLS.claudeToken)[0]?.body).not.toHaveProperty('scope');
    expect((await stored(user, id)).credentials.claudeAiOauth).toEqual({
      subscriptionType: 'max',
      accessToken: NEW_ACCESS,
      refreshToken: REFRESH,
    });
  });

  it('refreshes once after a 401 and asks again', async () => {
    const { user, id } = await login({ accessToken: ACCESS, refreshToken: REFRESH });
    w.provider
      .once(URLS.claudeUsage, json(401, {}))
      .once(URLS.claudeToken, json(200, { access_token: NEW_ACCESS, expires_in: 3600 }))
      .once(URLS.claudeUsage, json(200, USAGE));
    expect((await limitsOf(w, user)).get(id)?.windows).toHaveLength(1);
    expect(w.provider.calls.map((c) => [c.url, c.headers.authorization])).toEqual([
      [URLS.claudeUsage, `Bearer ${ACCESS}`],
      [URLS.claudeToken, undefined],
      [URLS.claudeUsage, `Bearer ${NEW_ACCESS}`],
    ]);
  });

  it('asks to sign in again after a 401 with a fresh token, a refused refresh, or no refresh token', async () => {
    const cases = [
      {
        tokens: { accessToken: ACCESS, refreshToken: REFRESH },
        answers: [
          [URLS.claudeUsage, json(401, {})],
          [URLS.claudeToken, json(200, { access_token: NEW_ACCESS })],
          [URLS.claudeUsage, json(401, {})],
        ],
      },
      {
        tokens: { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW },
        answers: [[URLS.claudeToken, json(400, { error: 'invalid_grant' })]],
      },
      { tokens: { accessToken: ACCESS, expiresAt: NOW }, answers: [] },
      { tokens: { refreshToken: REFRESH }, answers: [] },
    ] as const;
    for (const { tokens, answers } of cases) {
      w.provider.reset();
      const { user, id } = await login(tokens);
      for (const [url, answer] of answers) w.provider.once(url, answer);
      expect((await limitsOf(w, user)).get(id)?.error).toEqual({
        code: 'needs_sign_in',
        message: 'Sign in to this subscription again.',
      });
      expect((await rowOf(id))?.status).toBe('needs_sign_in');
      const audit = (await auditOf(id)).filter((r) => r.field === 'status' && r.action === 'update');
      expect(audit.map((r) => [r.actorKind, r.oldValue, r.newValue])).toEqual([
        ['system', 'active', 'needs_sign_in'],
      ]);
    }
  });

  it('does not ask to sign in again when the refresh is rate limited, the provider is down or answers nonsense', async () => {
    for (const [answer, code] of [
      [json(429, {}), 'rate_limited'],
      [json(503, {}), 'provider_unavailable'],
      [json(200, { token_type: 'bearer' }), 'invalid_response'],
    ] as const) {
      const { user, id } = await login({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: NOW });
      w.provider.once(URLS.claudeToken, answer);
      expect((await limitsOf(w, user)).get(id)?.error?.code).toBe(code);
      expect((await rowOf(id))?.status).toBe('active');
    }
  });

  it('turns a login that works again back to active', async () => {
    const { user, id } = await login({ accessToken: ACCESS, refreshToken: REFRESH }, 'needs_sign_in');
    w.provider.always(URLS.claudeUsage, json(200, USAGE));
    expect((await limitsOf(w, user)).get(id)?.error).toBeNull();
    expect((await rowOf(id))?.status).toBe('active');
    const audit = (await auditOf(id)).filter((r) => r.field === 'status' && r.action === 'update');
    expect(audit.map((r) => [r.oldValue, r.newValue])).toEqual([['needs_sign_in', 'active']]);
  });

  it('answers invalid_response for an answer that is not a JSON object, and provider_unavailable for a 5xx', async () => {
    for (const [answer, code] of [
      [() => new Response('<html>', { status: 200 }), 'invalid_response'],
      [json(200, [1, 2]), 'invalid_response'],
      [json(502, {}), 'provider_unavailable'],
    ] as const) {
      const { user, id } = await login({ accessToken: ACCESS, refreshToken: REFRESH });
      w.provider.once(URLS.claudeUsage, answer);
      expect((await limitsOf(w, user)).get(id)?.error?.code).toBe(code);
    }
  });
});
