import { amount, isoTime, limitWindow, members, text } from '../../rules/limits.ts';
import {
  type ClaudeLogin,
  discard,
  type LimitWindow,
  type LimitWindowId,
  type LoginContext,
  loginCheck,
  providerCall,
  readObject,
  refreshFailure,
  UsageFailure,
  type UsageOutcome,
} from './http.ts';

/**
 * A Claude login's limits (`claude_oauth`, S3.3): `GET api.anthropic.com/api/oauth/usage` with the login's access
 * token and the OAuth beta header, as v1's quota probe (and Claude Code's `/usage`) read it. An access token that is
 * expired or about to be is refreshed first. v1 left that to Claude Code itself (`claude auth status` in the login's
 * folder); the server has no CLI, so it makes Claude Code's own refresh call: its token URL and client id, JSON with
 * `grant_type=refresh_token` and the login's scopes, `expires_in` seconds becoming `expiresAt` in epoch ms. The new
 * token set is sealed again before it is used (`loginCheck` does the rest: one retry after a 401).
 */

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** Claude Code's OAuth client id: the logins the sign-in helper stores are its logins. */
export const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const OAUTH_BETA = 'oauth-2025-04-20';

/** The windows the usage API reports, in the order the card shows them; its utilization is a percentage. */
const WINDOWS: readonly LimitWindowId[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

type TokenSet = NonNullable<ClaudeLogin['credentials']['claudeAiOauth']>;

/** The windows of a usage answer; a window the answer leaves out (or without a utilization) is not shown. */
export function claudeWindows(body: Record<string, unknown>): LimitWindow[] {
  const windows: LimitWindow[] = [];
  for (const id of WINDOWS) {
    const window = members(body[id]);
    const used = amount(window.utilization);
    if (used !== null) windows.push(limitWindow(id, used, isoTime(window.resets_at)));
  }
  return windows;
}

/** Claude Code's refresh: a new token set for the login, sealed again; the login's account config is kept. */
async function refresh(login: ClaudeLogin, ctx: LoginContext<'claude_oauth'>): Promise<ClaudeLogin> {
  const tokens = login.credentials.claudeAiOauth as TokenSet;
  if (!tokens.refreshToken) throw new UsageFailure('needs_sign_in');
  const response = await providerCall(ctx.fetch, CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CLAUDE_CODE_CLIENT_ID,
      ...(tokens.scopes?.length ? { scope: tokens.scopes.join(' ') } : {}),
    }),
  });
  if (!response.ok) {
    await discard(response);
    throw refreshFailure(response.status);
  }
  const fresh = await readObject(response);
  const accessToken = text(fresh.access_token);
  if (accessToken === undefined) throw new UsageFailure('invalid_response');
  const expiresIn = amount(fresh.expires_in);
  const scope = text(fresh.scope);
  const next: TokenSet = {
    ...tokens,
    accessToken,
    refreshToken: text(fresh.refresh_token) ?? tokens.refreshToken,
    expiresAt: expiresIn === null ? undefined : ctx.clock().getTime() + expiresIn * 1000,
    scopes: scope === undefined ? tokens.scopes : scope.split(' '),
  };
  const refreshed: ClaudeLogin = { ...login, credentials: { ...login.credentials, claudeAiOauth: next } };
  await ctx.reseal(refreshed);
  return refreshed;
}

/** A Claude login's windows, refreshing its token when it has to (see above). */
export function checkClaudeOauth(
  login: ClaudeLogin,
  ctx: LoginContext<'claude_oauth'>,
): Promise<UsageOutcome> {
  return loginCheck(login, ctx.clock(), {
    accessToken: (l) => l.credentials.claudeAiOauth?.accessToken,
    expiresAt: (l) => l.credentials.claudeAiOauth?.expiresAt,
    refresh: (l) => refresh(l, ctx),
    usage: (l) =>
      providerCall(ctx.fetch, CLAUDE_USAGE_URL, {
        headers: {
          authorization: `Bearer ${l.credentials.claudeAiOauth?.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
        },
      }),
    windows: claudeWindows,
  });
}
