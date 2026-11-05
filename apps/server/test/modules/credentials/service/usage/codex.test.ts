import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codexWindows, jwtExpiry } from '../../../../../src/modules/credentials/service/usage/codex.ts';
import { addUser, type LinkedUser } from '../../../../fixtures/companies.ts';
import {
  codexLogin,
  json,
  jwt,
  type LimitsWorld,
  limitsOf,
  limitsWorld,
  URLS,
} from '../../../../fixtures/credentials/providers.ts';

const NOW_S = Date.parse(TEST_NOW) / 1000;
const ACCESS = jwt(NOW_S + 10 * 24 * 3600, 'CODEXaccessOLD');
const NEW_ACCESS = jwt(NOW_S + 10 * 24 * 3600, 'CODEXaccessNEW');
const REFRESH = 'rt_CODEXrefreshOLD';
const NEW_REFRESH = 'rt_CODEXrefreshNEW';
const WHAM = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_762_190_000 },
    secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1_762_600_000 },
  },
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

async function login(tokens: Parameters<typeof codexLogin>[0]) {
  const user = await addUser(w.t.db, w.fake);
  const view = await w.store.storeCredential({
    ownerUserId: user.userId,
    kind: 'codex_oauth',
    label: 'ChatGPT Pro',
    secret: codexLogin(tokens),
  });
  return { user, id: view.id };
}

const stored = async (user: LinkedUser, id: string) => {
  const used = await w.store.useCredentialSecret(id, user.userId, 'test_read');
  if (!used.ok || used.kind !== 'codex_oauth') throw new Error('not an OpenAI login');
  return used.secret;
};

describe('codexWindows', () => {
  it('maps the windows by their length, whatever their order', () => {
    const swapped = {
      rate_limit: {
        primary_window: { used_percent: 70, limit_window_seconds: 604800, reset_at: 1_762_600_000 },
        secondary_window: { used_percent: 100, limit_window_seconds: 18000 },
      },
    };
    expect(codexWindows(swapped)).toEqual([
      {
        id: 'weekly',
        label: 'Weekly limit',
        usedPercent: 70,
        resetsAt: new Date(1_762_600_000_000).toISOString(),
        reached: false,
      },
      { id: 'five_hour', label: '5-hour limit', usedPercent: 100, resetsAt: null, reached: true },
    ]);
  });

  it('falls back to the position without a length, keeps the first of two the same, and leaves out missing ones', () => {
    expect(
      codexWindows({
        rate_limit: { primary_window: { used_percent: 1 }, secondary_window: { used_percent: 2 } },
      }).map((x) => x.id),
    ).toEqual(['five_hour', 'weekly']);
    const twoShort = {
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 3600 },
        secondary_window: { used_percent: 2, limit_window_seconds: 18000 },
      },
    };
    expect(codexWindows(twoShort).map((x) => [x.id, x.usedPercent])).toEqual([['five_hour', 1]]);
    expect(codexWindows({ rate_limit: { secondary_window: { limit_window_seconds: 604800 } } })).toEqual([]);
    expect(codexWindows({})).toEqual([]);
  });
});

describe('jwtExpiry', () => {
  it('reads exp in ms, and nothing from a token that is not a JWT or has no exp', () => {
    expect(jwtExpiry(jwt(1_800_000_000))).toBe(1_800_000_000_000);
    expect(jwtExpiry(jwt(undefined))).toBeUndefined();
    expect(jwtExpiry('opaque-token')).toBeUndefined();
    expect(jwtExpiry('a.not-json.b')).toBeUndefined();
  });
});

describe('an OpenAI login', () => {
  it('asks wham/usage with its access token and account id', async () => {
    const { user, id } = await login({ access_token: ACCESS, refresh_token: REFRESH, account_id: 'acct-1' });
    w.provider.always(URLS.codexUsage, json(200, WHAM));
    const limits = (await limitsOf(w, user)).get(id);
    expect(limits).toMatchObject({ source: 'usage_api', error: null, stale: false });
    expect(limits?.windows.map((x) => [x.id, x.usedPercent])).toEqual([
      ['five_hour', 12],
      ['weekly', 40],
    ]);
    expect(w.provider.calls[0]).toMatchObject({
      method: 'GET',
      headers: { authorization: `Bearer ${ACCESS}`, 'chatgpt-account-id': 'acct-1' },
      redirect: 'error',
      hasDeadline: true,
    });
  });

  it('refreshes an access token about to expire first and seals the new auth.json, keeping the account id', async () => {
    const expiring = jwt(NOW_S + 60, 'CODEXaccessEXPIRING');
    const { user, id } = await login({
      access_token: expiring,
      refresh_token: REFRESH,
      id_token: 'id-old',
      account_id: 'acct-1',
    });
    w.provider
      .once(
        URLS.codexToken,
        json(200, { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, id_token: 'id-new' }),
      )
      .always(URLS.codexUsage, json(200, WHAM));
    expect((await limitsOf(w, user)).get(id)?.error).toBeNull();
    expect(w.provider.callsTo(URLS.codexToken)[0]?.body).toEqual({
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      grant_type: 'refresh_token',
      refresh_token: REFRESH,
      scope: 'openid profile email',
    });
    expect(w.provider.callsTo(URLS.codexUsage)[0]?.headers.authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect((await stored(user, id)).auth).toEqual({
      OPENAI_API_KEY: null,
      tokens: {
        access_token: NEW_ACCESS,
        refresh_token: NEW_REFRESH,
        id_token: 'id-new',
        account_id: 'acct-1',
      },
      last_refresh: TEST_NOW,
    });
  });

  it('refreshes once after a 401 (keeping the tokens the refresh does not return) and asks again', async () => {
    const { user, id } = await login({
      access_token: 'opaque-old',
      refresh_token: REFRESH,
      id_token: 'id-old',
    });
    w.provider
      .once(URLS.codexUsage, json(401, {}))
      .once(URLS.codexToken, json(200, { access_token: NEW_ACCESS }))
      .once(URLS.codexUsage, json(200, WHAM));
    expect((await limitsOf(w, user)).get(id)?.windows).toHaveLength(2);
    expect(w.provider.callsTo(URLS.codexUsage)[1]?.headers).not.toHaveProperty('chatgpt-account-id');
    expect((await stored(user, id)).auth.tokens).toEqual({
      access_token: NEW_ACCESS,
      refresh_token: REFRESH,
      id_token: 'id-old',
    });
  });

  it('asks to sign in again after a refused refresh, with no tokens, or after a second 401', async () => {
    const cases = [
      {
        tokens: { access_token: jwt(NOW_S), refresh_token: REFRESH },
        answers: [[URLS.codexToken, json(401, {})]],
      },
      { tokens: { access_token: jwt(NOW_S) }, answers: [] },
      { tokens: {}, answers: [] },
      {
        tokens: { access_token: ACCESS, refresh_token: REFRESH },
        answers: [
          [URLS.codexUsage, json(401, {})],
          [URLS.codexToken, json(200, { access_token: NEW_ACCESS })],
          [URLS.codexUsage, json(401, {})],
        ],
      },
    ] as const;
    for (const { tokens, answers } of cases) {
      w.provider.reset();
      const { user, id } = await login(tokens);
      for (const [url, answer] of answers) w.provider.once(url, answer);
      expect((await limitsOf(w, user)).get(id)?.error?.code).toBe('needs_sign_in');
      const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id));
      expect(row?.status).toBe('needs_sign_in');
    }
  });

  it('answers a refresh without an access token as invalid, and a rate-limited refresh as rate limited', async () => {
    for (const [answer, code] of [
      [json(200, {}), 'invalid_response'],
      [json(429, {}), 'rate_limited'],
    ] as const) {
      const { user, id } = await login({ access_token: jwt(NOW_S), refresh_token: REFRESH });
      w.provider.once(URLS.codexToken, answer);
      expect((await limitsOf(w, user)).get(id)?.error?.code).toBe(code);
    }
  });
});
