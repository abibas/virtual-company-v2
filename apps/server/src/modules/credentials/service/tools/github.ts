import { githubAccount, githubMeta, githubTokenType } from '../../rules/tool-accounts.ts';
import { type ToolOutcome, toolFailureOf } from '../../rules/tools.ts';
import { discard, type ProviderFetch } from '../usage/http.ts';
import { answerOf, failed } from './http.ts';

/**
 * GitHub's check of a token (S7.1a): `GET https://api.github.com/user` with it as the bearer. The answer names the
 * account and, for a classic or OAuth token, its scopes (`X-OAuth-Scopes`; a fine-grained token has none). A 401 means
 * signing in again; a 403 with no requests left in its rate window is a rate limit.
 */

export const GITHUB_USER_URL = 'https://api.github.com/user';

/** GitHub's REST API version the check asks for. */
export const GITHUB_API_VERSION = '2022-11-28';

/** How the server names itself to GitHub and Atlassian (GitHub refuses a call without a User-Agent). */
export const TOOL_USER_AGENT = 'mwc';

/**
 * Checks a GitHub token: who it acts as and its scopes. `pasted` (a `github_token`) also records the token's type,
 * classic or fine-grained.
 */
export async function checkGitHub(
  fetchFn: ProviderFetch,
  token: string,
  pasted: boolean,
): Promise<ToolOutcome> {
  const answer = await answerOf(fetchFn, GITHUB_USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': TOOL_USER_AGENT,
      'x-github-api-version': GITHUB_API_VERSION,
    },
  });
  if (!answer.ok) return answer;
  const { response } = answer;
  if (response.status !== 200) {
    await discard(response);
    const spent = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
    return failed(spent ? 'rate_limited' : toolFailureOf(response.status));
  }
  const body = await answer.read();
  if (body === undefined) return failed('invalid_response');
  const account = githubAccount(body, response.headers.get('x-oauth-scopes'));
  if (account === undefined) return failed('invalid_response');
  return {
    ok: true,
    accountEmail: account.email,
    accountMeta: githubMeta(account, pasted ? githubTokenType(token) : undefined),
  };
}
