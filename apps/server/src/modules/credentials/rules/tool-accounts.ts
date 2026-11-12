import type { AccountMeta } from '../schemas.ts';

/**
 * Who a tool sign-in acts as, from its provider's answers (S7.1a), as pure rules: GitHub's `GET /user` with its
 * `X-OAuth-Scopes` header (from the server's check, or from `gh api user --include` in the sign-in helper's sandbox),
 * and Atlassian's Jira `myself` and Confluence `user/current`. Only names and ids are kept, never a token.
 */

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** The entries whose value is set (not null). */
const present = (entries: Record<string, unknown>): AccountMeta =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== null));

/** A GitHub account: its login, its name and public email when it shows them, and the token's scopes. */
export interface GitHubAccount {
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  /** The token's OAuth scopes; null when GitHub sends none (a fine-grained token has permissions, not scopes). */
  readonly scopes: string[] | null;
}

/** `X-OAuth-Scopes: repo, read:org, gist` as its scopes; null without the header. */
export function githubScopes(header: string | null | undefined): string[] | null {
  if (header === null || header === undefined) return null;
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
}

/** GitHub's `GET /user` answer as the account; undefined when it names no login. */
export function githubAccount(
  body: Record<string, unknown>,
  scopes: string | null | undefined,
): GitHubAccount | undefined {
  const login = text(body.login);
  if (login === null) return undefined;
  return { login, name: text(body.name), email: text(body.email), scopes: githubScopes(scopes) };
}

/** A pasted token's type, from its prefix. */
export const githubTokenType = (token: string): 'classic' | 'fine_grained' =>
  token.startsWith('github_pat_') ? 'fine_grained' : 'classic';

/** A GitHub sign-in's account details: the host, login, name, scopes and (for a pasted token) its type. */
export function githubMeta(account: GitHubAccount, tokenType?: 'classic' | 'fine_grained'): AccountMeta {
  return present({
    host: 'github.com',
    login: account.login,
    name: account.name,
    scopes: account.scopes,
    tokenType: tokenType ?? null,
  });
}

/** An answer as `gh api --include` prints it: the status line, the headers, a blank line, then the body. */
export interface IncludedAnswer {
  readonly status: number;
  /** The headers, by lower-case name. */
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
}

/** `gh api --include`'s output read back; undefined when it does not start with an HTTP status line. */
export function includedAnswer(output: string): IncludedAnswer | undefined {
  const normalized = output.replace(/\r\n/g, '\n');
  const blank = normalized.indexOf('\n\n');
  const head = blank === -1 ? normalized : normalized.slice(0, blank);
  const [statusLine = '', ...lines] = head.split('\n');
  const status = /^HTTP\/[\d.]+ (\d{3})\b/.exec(statusLine.trim())?.[1];
  if (status === undefined) return undefined;
  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { status: Number(status), headers, body: blank === -1 ? '' : normalized.slice(blank + 2) };
}

/** Which Atlassian products answered for the account, and who it is there. */
export interface AtlassianAccount {
  readonly jira: boolean;
  readonly confluence: boolean;
  readonly accountId: string | null;
  readonly displayName: string | null;
}

/**
 * The account from Jira's `myself` and Confluence's `user/current` answers (undefined: that product did not answer
 * with one): Jira's names first. Confluence answers an anonymous user (`type: anonymous`) when it does not know the
 * caller, which is no answer.
 */
export function atlassianAccount(
  jira: Record<string, unknown> | undefined,
  confluence: Record<string, unknown> | undefined,
): AtlassianAccount {
  const known = confluence !== undefined && confluence.type !== 'anonymous' ? confluence : undefined;
  return {
    jira: jira !== undefined,
    confluence: known !== undefined,
    accountId: text(jira?.accountId) ?? text(known?.accountId),
    displayName: text(jira?.displayName) ?? text(known?.displayName) ?? text(known?.publicName),
  };
}

/** An Atlassian sign-in's account details: the site, which products answer, and who the account is there. */
export function atlassianMeta(site: string, account: AtlassianAccount): AccountMeta {
  return present({
    site,
    jira: account.jira,
    confluence: account.confluence,
    accountId: account.accountId,
    displayName: account.displayName,
  });
}
