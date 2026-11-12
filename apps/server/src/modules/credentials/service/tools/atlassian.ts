import { atlassianAccount, atlassianMeta } from '../../rules/tool-accounts.ts';
import { type ToolFailure, type ToolOutcome, toolFailureOf } from '../../rules/tools.ts';
import type { SecretOf } from '../../schemas/secrets.ts';
import { discard, type ProviderFetch } from '../usage/http.ts';
import { answerOf, failed } from './http.ts';
import { TOOL_USER_AGENT } from './github.ts';

/**
 * Atlassian's check of a site, an account email and an API token (S7.1a): Jira's `GET /rest/api/3/myself` and
 * Confluence's `GET /wiki/rest/api/user/current` on the site, both with basic auth, side by side. Each product that
 * answers with the account counts; the account's name and id come from Jira, else Confluence. When neither does, a 401
 * means signing in again, and two products that are not there (404) or not open to the account (403) are
 * `no_products`.
 */

export const jiraMyselfUrl = (site: string) => `https://${site}/rest/api/3/myself`;
export const confluenceCurrentUrl = (site: string) => `https://${site}/wiki/rest/api/user/current`;

/** One product's answer: the account it names, or the status it refused with, or no answer at all. */
type ProductAnswer =
  | { readonly body: Record<string, unknown> }
  | { readonly status: number }
  | { readonly code: ToolFailure };

async function ask(fetchFn: ProviderFetch, url: string, authorization: string): Promise<ProductAnswer> {
  const answer = await answerOf(fetchFn, url, {
    headers: { accept: 'application/json', authorization, 'user-agent': TOOL_USER_AGENT },
  });
  if (!answer.ok) return { code: answer.code };
  if (answer.response.status !== 200) {
    await discard(answer.response);
    return { status: answer.response.status };
  }
  const body = await answer.read();
  return body === undefined ? { code: 'invalid_response' } : { body };
}

const bodyOf = (answer: ProductAnswer) => ('body' in answer ? answer.body : undefined);

/**
 * Why neither product named the account: a 401 first (Confluence's anonymous user counts as one), then a rate limit,
 * an outage, two absent products, the rest.
 */
function failureOf(answers: readonly ProductAnswer[]): ToolFailure {
  const codes = answers.map((answer) =>
    'status' in answer ? toolFailureOf(answer.status) : 'code' in answer ? answer.code : 'needs_sign_in',
  );
  const absent = answers.every((answer) => 'status' in answer && [403, 404].includes(answer.status));
  if (codes.includes('needs_sign_in')) return 'needs_sign_in';
  if (codes.includes('rate_limited')) return 'rate_limited';
  if (codes.includes('provider_unavailable')) return 'provider_unavailable';
  return absent ? 'no_products' : 'invalid_response';
}

/** Checks an Atlassian sign-in: which of Jira and Confluence answer on its site, and who the account is there. */
export async function checkAtlassian(
  fetchFn: ProviderFetch,
  secret: SecretOf<'atlassian_api_token'>,
): Promise<ToolOutcome> {
  const authorization = `Basic ${Buffer.from(`${secret.email}:${secret.token}`).toString('base64')}`;
  const [jira, confluence] = await Promise.all([
    ask(fetchFn, jiraMyselfUrl(secret.site), authorization),
    ask(fetchFn, confluenceCurrentUrl(secret.site), authorization),
  ]);
  const account = atlassianAccount(bodyOf(jira), bodyOf(confluence));
  if (!account.jira && !account.confluence) return failed(failureOf([jira, confluence]));
  return { ok: true, accountEmail: secret.email, accountMeta: atlassianMeta(secret.site, account) };
}
