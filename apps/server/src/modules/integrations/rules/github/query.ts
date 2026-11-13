import type { GitHubRights } from '@mwc/shared/credentials';
import { outsideRepos, ownerInScope, repoInScope, splitRepo } from './rights.ts';

/**
 * A GitHub search kept inside the profile's repositories (S7.1d). The query's own scope qualifiers (`repo:`, `user:`,
 * `org:`, not negated) and the tool's `owner` and `repo` must each be inside the allowlist (an owner only when the
 * allowlist holds all of its repositories, `owner/*`); a search that names none gets the allowlist's as qualifiers
 * (`user:owner` for `owner/*`, `repo:owner/name` for one; GitHub ORs them). With `all` nothing is added. A pull request
 * or issue search gets its `is:pr` or `is:issue`. The tools also drop any result outside the allowlist.
 */

export type ScopedSearch =
  | { readonly ok: true; readonly q: string }
  | { readonly ok: false; readonly error: string };

/** A scope qualifier at the start or after a space: its kind and value (quotes taken off). */
const SCOPE = /(?:^|\s)(repo|user|org):("[^"]*"|\S+)/gi;

type Scope = { readonly kind: 'repo' | 'owner'; readonly value: string };

/** The scopes the query names. */
export function scopesOf(query: string): Scope[] {
  return [...query.matchAll(SCOPE)].map((match) => ({
    kind: (match[1] as string).toLowerCase() === 'repo' ? 'repo' : 'owner',
    value: (match[2] as string).replace(/^"|"$/g, ''),
  }));
}

/** Why a scope reaches outside the allowlist, or undefined. */
function scopeRefusal(repos: GitHubRights['repos'], scope: Scope): string | undefined {
  if (repos === 'all') return undefined;
  if (scope.kind === 'owner') {
    if (ownerInScope(repos, scope.value)) return undefined;
    return `${outsideRepos(`Every repository of ${scope.value}`, repos)} Name the repositories with repo: instead.`;
  }
  const repo = splitRepo(scope.value);
  if (repo !== undefined && repoInScope(repos, repo.owner, repo.name)) return undefined;
  return outsideRepos(scope.value, repos);
}

/** The allowlist as search qualifiers. */
const allowlistQualifiers = (repos: readonly string[]) =>
  repos.map((entry) => (entry.endsWith('/*') ? `user:${entry.slice(0, -2)}` : `repo:${entry}`));

/** The type qualifier a kind of search needs, unless the query has it. */
function typeQualifier(query: string, kind: 'pr' | 'issue' | 'repository'): string[] {
  if (kind === 'repository') return [];
  const wanted =
    kind === 'pr' ? /(?:^|\s)(?:is|type):(?:pr|pull-request)\b/i : /(?:^|\s)(?:is|type):issue\b/i;
  return wanted.test(query) ? [] : [kind === 'pr' ? 'is:pr' : 'is:issue'];
}

/** The search's query kept inside the allowlist (see above), or why not. */
export function scopedSearch(
  input: { readonly query: string; readonly owner?: string | undefined; readonly repo?: string | undefined },
  kind: 'pr' | 'issue' | 'repository',
  repos: GitHubRights['repos'],
): ScopedSearch {
  const named: Scope[] = [];
  if (input.owner !== undefined && input.repo !== undefined)
    named.push({ kind: 'repo', value: `${input.owner}/${input.repo}` });
  else if (input.owner !== undefined) named.push({ kind: 'owner', value: input.owner });
  const scopes = [...scopesOf(input.query), ...named];
  for (const scope of scopes) {
    const refusal = scopeRefusal(repos, scope);
    if (refusal !== undefined) return { ok: false, error: refusal };
  }
  const added = named.map((scope) => `${scope.kind === 'repo' ? 'repo' : 'user'}:${scope.value}`);
  const scoped = scopes.length > 0 || repos === 'all' ? [] : allowlistQualifiers(repos);
  const q = [input.query, ...added, ...scoped, ...typeQualifier(input.query, kind)].join(' ');
  return { ok: true, q };
}
