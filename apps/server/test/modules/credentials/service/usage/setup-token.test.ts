import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { headerWindows } from '../../../../../src/modules/credentials/service/usage/setup-token.ts';
import { addUser, call } from '../../../../fixtures/companies.ts';
import {
  type Answer,
  type LimitsWorld,
  limitsOf,
  limitsWorld,
  URLS,
} from '../../../../fixtures/credentials/providers.ts';

const TOKEN = 'sk-ant-oat01-PROBEtokenNEVERshown_0123456789';
const RESET_5H = 1_762_190_000;
const RESET_7D = 1_762_600_000;
const P = 'anthropic-ratelimit-unified-';

/** A Messages answer with the rate-limit headers (and a reply that is never read). */
const answer =
  (status: number, headers: Record<string, string>): Answer =>
  () =>
    new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hi' }] }), { status, headers });

const HEADERS = {
  [`${P}5h-utilization`]: '0.1234',
  [`${P}5h-reset`]: String(RESET_5H),
  [`${P}5h-status`]: 'allowed',
  [`${P}7d-utilization`]: '0.5',
  [`${P}7d-reset`]: String(RESET_7D),
  [`${P}7d_opus-utilization`]: '0.25',
  [`${P}7d_sonnet-utilization`]: '0.05',
  [`${P}7d_sonnet-reset`]: String(RESET_7D),
  [`${P}overage-utilization`]: '0.9',
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

async function setupToken() {
  const user = await addUser(w.t.db, w.fake);
  const res = await call(w, user.token)('POST', '/api/me/subscriptions', {
    kind: 'claude_setup_token',
    label: 'Setup',
    token: TOKEN,
  });
  return { user, id: (res.body as { id: string }).id };
}

describe('headerWindows', () => {
  it('reads each claim it knows: the fraction as a percentage, the reset in epoch seconds, rejected as reached', () => {
    const headers = new Headers({ ...HEADERS, [`${P}7d-status`]: 'rejected' });
    expect(headerWindows(headers)).toEqual([
      {
        id: 'five_hour',
        label: '5-hour limit',
        usedPercent: 12.34,
        resetsAt: new Date(RESET_5H * 1000).toISOString(),
        reached: false,
      },
      {
        id: 'seven_day',
        label: 'Weekly limit',
        usedPercent: 50,
        resetsAt: new Date(RESET_7D * 1000).toISOString(),
        reached: true,
      },
      { id: 'seven_day_opus', label: 'Opus weekly limit', usedPercent: 25, resetsAt: null, reached: false },
      {
        id: 'seven_day_sonnet',
        label: 'Sonnet weekly limit',
        usedPercent: 5,
        resetsAt: new Date(RESET_7D * 1000).toISOString(),
        reached: false,
      },
    ]);
  });

  it('leaves out a claim with no, a blank, a negative or a non-numeric utilization, and a reset that is not a time', () => {
    const headers = new Headers({
      [`${P}5h-utilization`]: ' ',
      [`${P}7d-utilization`]: '-0.1',
      [`${P}7d_opus-utilization`]: 'lots',
      [`${P}7d_sonnet-utilization`]: '1',
      [`${P}7d_sonnet-reset`]: 'soon',
    });
    expect(headerWindows(headers)).toEqual([
      {
        id: 'seven_day_sonnet',
        label: 'Sonnet weekly limit',
        usedPercent: 100,
        resetsAt: null,
        reached: true,
      },
    ]);
    expect(headerWindows(new Headers())).toEqual([]);
  });
});

describe('a setup-token', () => {
  it('reads its limits from the headers of a one-token Messages request of the cheapest Haiku', async () => {
    const { user, id } = await setupToken();
    w.provider.once(URLS.messages, answer(200, HEADERS));
    const limits = (await limitsOf(w, user)).get(id);
    expect(limits).toMatchObject({
      source: 'message_headers',
      error: null,
      stale: false,
      checkedAt: TEST_NOW,
    });
    expect(limits?.windows.map((x) => [x.id, x.usedPercent])).toEqual([
      ['five_hour', 12.34],
      ['seven_day', 50],
      ['seven_day_opus', 25],
      ['seven_day_sonnet', 5],
    ]);
    expect(w.provider.calls).toEqual([
      {
        url: URLS.messages,
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: { model: 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
        redirect: 'error',
        hasDeadline: true,
      },
    ]);
  });

  it('reads the headers of a 429 too: a reached window is reached, and it is no error', async () => {
    const { user, id } = await setupToken();
    w.provider.once(
      URLS.messages,
      answer(429, { ...HEADERS, [`${P}5h-utilization`]: '1.0', [`${P}5h-status`]: 'rejected' }),
    );
    const limits = (await limitsOf(w, user)).get(id);
    expect(limits?.error).toBeNull();
    expect(limits?.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 100, reached: true });
  });

  it('answers each refusal in plain words', async () => {
    for (const [status, headers, code] of [
      [429, {}, 'rate_limited'],
      [200, {}, 'invalid_response'],
      [403, HEADERS, 'usage_refused'],
      [500, HEADERS, 'provider_unavailable'],
    ] as const) {
      const { user, id } = await setupToken();
      w.provider.once(URLS.messages, answer(status, headers));
      expect((await limitsOf(w, user)).get(id)?.error?.code).toBe(code);
    }
  });

  it('asks to sign in again when the token is refused (401), and no network failure leaks', async () => {
    const { user, id } = await setupToken();
    w.provider.once(URLS.messages, answer(401, {}));
    expect((await limitsOf(w, user)).get(id)?.error?.code).toBe('needs_sign_in');
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id));
    expect(row?.status).toBe('needs_sign_in');
    const other = await setupToken();
    w.provider.once(URLS.messages, () => Promise.reject(new TypeError(`fetch failed for ${TOKEN}`)));
    expect((await limitsOf(w, other.user)).get(other.id)?.error?.code).toBe('provider_unavailable');
    expect(JSON.stringify(w.t.logs)).not.toContain(TOKEN);
  });
});
