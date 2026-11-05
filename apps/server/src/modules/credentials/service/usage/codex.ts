import { amount, isoTime, limitWindow, members, text } from '../../rules/limits.ts';
import {
  type CodexLogin,
  discard,
  type LimitWindow,
  type LoginContext,
  loginCheck,
  providerCall,
  readObject,
  refreshFailure,
  UsageFailure,
  type UsageOutcome,
} from './http.ts';

/**
 * An OpenAI login's limits (`codex_oauth`, S3.3): `GET chatgpt.com/backend-api/wham/usage` with the login's access
 * token and its `ChatGPT-Account-Id`, as Codex reads it. Its `rate_limit` has a primary and a secondary window, each
 * with `used_percent`, `limit_window_seconds` and `reset_at` (epoch seconds); a window of a day or less is the 5-hour
 * one, a longer one the weekly one. An access token whose JWT `exp` is past or near is refreshed first, the way v1
 * refreshed it after a 401 (`mw-codex-subscription-refresh.ts`: `auth.openai.com/oauth/token`, Codex's client id,
 * `last_refresh` now, `account_id` kept), and the new `auth.json` is sealed again (`loginCheck` does the rest: one
 * retry after a 401).
 */

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** Codex's OAuth client id: the logins the sign-in helper stores are its logins. */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const DAY_SECONDS = 24 * 60 * 60;

type Tokens = NonNullable<CodexLogin['auth']['tokens']>;

/** A JWT's `exp` in epoch ms, read without verifying it (only to know when to refresh); undefined when unreadable. */
export function jwtExpiry(token: string): number | undefined {
  try {
    const payload = members(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')));
    const exp = amount(payload.exp);
    return exp === null ? undefined : exp * 1000;
  } catch {
    return undefined;
  }
}

/** The windows of a `wham/usage` answer, by their length (the primary is the 5-hour one when it does not say). */
export function codexWindows(body: Record<string, unknown>): LimitWindow[] {
  const group = members(body.rate_limit);
  const windows: LimitWindow[] = [];
  for (const [key, fallback] of [
    ['primary_window', 'five_hour'],
    ['secondary_window', 'weekly'],
  ] as const) {
    const window = members(group[key]);
    const used = amount(window.used_percent);
    if (used === null) continue;
    const seconds = amount(window.limit_window_seconds);
    const id = seconds === null ? fallback : seconds <= DAY_SECONDS ? 'five_hour' : 'weekly';
    if (windows.some((w) => w.id === id)) continue;
    windows.push(limitWindow(id, used, isoTime(window.reset_at)));
  }
  return windows;
}

/** Codex's refresh: new access, id and refresh tokens for the saved `auth.json`, sealed again. */
async function refresh(login: CodexLogin, ctx: LoginContext<'codex_oauth'>): Promise<CodexLogin> {
  const tokens = login.auth.tokens as Tokens;
  if (!tokens.refresh_token) throw new UsageFailure('needs_sign_in');
  const response = await providerCall(ctx.fetch, CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      scope: 'openid profile email',
    }),
  });
  if (!response.ok) {
    await discard(response);
    throw refreshFailure(response.status);
  }
  const fresh = await readObject(response);
  const accessToken = text(fresh.access_token);
  if (accessToken === undefined) throw new UsageFailure('invalid_response');
  const next: Tokens = {
    ...tokens,
    access_token: accessToken,
    id_token: text(fresh.id_token) ?? tokens.id_token,
    refresh_token: text(fresh.refresh_token) ?? tokens.refresh_token,
  };
  const refreshed: CodexLogin = {
    ...login,
    auth: { ...login.auth, tokens: next, last_refresh: ctx.clock().toISOString() },
  };
  await ctx.reseal(refreshed);
  return refreshed;
}

/** An OpenAI login's windows, refreshing its token when it has to (see above). */
export function checkCodexOauth(login: CodexLogin, ctx: LoginContext<'codex_oauth'>): Promise<UsageOutcome> {
  return loginCheck(login, ctx.clock(), {
    accessToken: (l) => l.auth.tokens?.access_token,
    expiresAt: (l) => {
      const access = l.auth.tokens?.access_token;
      return access === undefined ? undefined : jwtExpiry(access);
    },
    refresh: (l) => refresh(l, ctx),
    usage: (l) => {
      const tokens = l.auth.tokens as Tokens;
      return providerCall(ctx.fetch, CODEX_USAGE_URL, {
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          ...(tokens.account_id ? { 'ChatGPT-Account-Id': tokens.account_id } : {}),
        },
      });
    },
    windows: codexWindows,
  });
}
