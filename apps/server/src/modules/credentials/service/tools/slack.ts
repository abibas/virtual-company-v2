import { slackAccount, slackMeta } from '../../rules/tool-accounts.ts';
import { type ToolFailure, type ToolOutcome, toolFailureOf } from '../../rules/tools.ts';
import type { SecretOf } from '../../schemas/secrets.ts';
import { discard, type ProviderFetch } from '../usage/http.ts';
import { TOOL_USER_AGENT } from './github.ts';
import { answerOf, failed } from './http.ts';

/**
 * Slack's check of a token (S7.1e): `POST https://slack.com/api/auth.test` with it as the bearer. Slack answers 200 with
 * `{ok: true}` and the workspace, the bot's or the person's name and the bot's id, and the token's scopes in the
 * `X-OAuth-Scopes` header; or 200 with `{ok: false, error}`: an invalid, revoked or expired token (`invalid_auth`,
 * `token_revoked`, …) means signing in again. A token whose kind is not what it says (a bot token naming no bot) is
 * refused.
 */

export const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test';

/** The errors that mean the token no longer works: add it again. */
const SIGN_IN_AGAIN = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
]);

/** Slack's `{ok: false}` error as a check's failure. */
function failureOf(error: unknown): ToolFailure {
  if (typeof error === 'string' && SIGN_IN_AGAIN.has(error)) return 'needs_sign_in';
  if (error === 'ratelimited') return 'rate_limited';
  if (error === 'fatal_error' || error === 'internal_error' || error === 'service_unavailable')
    return 'provider_unavailable';
  return error === 'not_allowed_token_type' || error === 'no_permission' ? 'refused' : 'invalid_response';
}

/** Checks a Slack token: its workspace, who it acts as, and its scopes. */
export async function checkSlack(
  fetchFn: ProviderFetch,
  kind: 'slack_bot_token' | 'slack_user_token',
  secret: SecretOf<'slack_bot_token'>,
): Promise<ToolOutcome> {
  const answer = await answerOf(fetchFn, SLACK_AUTH_TEST_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.token}`, 'user-agent': TOOL_USER_AGENT },
  });
  if (!answer.ok) return answer;
  const { response } = answer;
  if (response.status !== 200) {
    await discard(response);
    return failed(toolFailureOf(response.status));
  }
  const body = await answer.read();
  if (body === undefined) return failed('invalid_response');
  if (body.ok !== true) return failed(failureOf(body.error));
  const account = slackAccount(body, response.headers.get('x-oauth-scopes'));
  if (account === undefined || (account.botId === null) !== (kind === 'slack_user_token'))
    return failed('invalid_response');
  return { ok: true, accountEmail: null, accountMeta: slackMeta(account) };
}
